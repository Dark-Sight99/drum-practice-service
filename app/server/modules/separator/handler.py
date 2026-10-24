"""JobType.SEPARATE 작업 핸들러. 근거: REQ-01, REQ-10, work/T3-1/plan.md §3.

구현은 plan.md §3의 확정 의사코드를 그대로 따른다 — 변경 시 plan.md도 같이 갱신할 것.
"""

import logging
import shutil
import tempfile
import time
from pathlib import Path

from db import session as db_session
from db.models import Asset, AssetKind, Job, Song, SongStatus
from file_storage import resolve_asset_path, write_song_file
from modules.separator.demucs_separator import separate

logger = logging.getLogger("worker.separate")

STEM_NAME_TO_ASSET_KIND: dict[str, AssetKind] = {
    "drums": AssetKind.STEM_DRUMS,
    "bass": AssetKind.STEM_BASS,
    "other": AssetKind.STEM_OTHER,
    "vocals": AssetKind.STEM_VOCALS,
}


def _original_asset_path(db, song_id: int) -> Path:
    asset = (
        db.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.ORIGINAL)
        .first()
    )
    if asset is None:
        raise RuntimeError(f"song={song_id}에 ORIGINAL 에셋이 없습니다")
    path = resolve_asset_path(asset.file_path)
    if path is None or not path.exists():
        raise RuntimeError(f"song={song_id}의 원본 파일을 찾을 수 없습니다: {asset.file_path}")
    return path


def separate_handler(job: Job) -> None:
    # JobHandler 시그니처(Callable[[Job], None])가 db 세션을 안 받으므로 직접 연다.
    # `db.session`을 모듈로 import해 `db_session.SessionLocal()`로 호출 —
    # `from db.session import SessionLocal`로 바인딩하면 테스트가
    # `monkeypatch.setattr(db.session, "SessionLocal", ...)`로 교체해도 이미
    # 임포트 시점에 묶인 이름이라 반영되지 않는다(file_storage.SONGS_ROOT를
    # 속성 접근으로 두는 것과 같은 이유).
    db = db_session.SessionLocal()
    try:
        song = db.get(Song, job.song_id)
        if song is None:
            raise RuntimeError(f"job={job.id}의 song={job.song_id}을 찾을 수 없습니다")

        song.status = SongStatus.PROCESSING
        db.commit()

        # 이 지점부터(ORIGINAL 경로 조회·임시 디렉터리 생성 포함) Song.PROCESSING 이후
        # 발생하는 모든 실패를 하나의 범위로 묶는다 — "일부만 실패 처리됨" 간극이
        # 생기지 않도록(work/T3-1/plan.md 모드C C-011: ORIGINAL 조회 실패·임시
        # 디렉터리 생성 실패도 stem 쓰기 실패·Asset 커밋 실패와 동일하게 Song.FAILED로
        # 귀결돼야 한다 — 핸들러 단위 테스트로 직접 재현해 발견한 간극).
        temp_dir: Path | None = None
        written: list[tuple[str, str]] = []
        try:
            original_path = _original_asset_path(db, song.id)
            temp_dir = Path(tempfile.mkdtemp(prefix=f"separate_{song.id}_"))

            start = time.monotonic()
            stems = separate(original_path, temp_dir)
            elapsed = time.monotonic() - start
            logger.info("separate song=%s elapsed=%.1fs device_auto=yes", song.id, elapsed)

            for name, stem_path in stems.items():
                rel_path = write_song_file(song.id, f"stem_{name}.wav", stem_path.read_bytes())
                written.append((name, rel_path))
            for name, rel_path in written:
                db.add(
                    Asset(
                        song_id=song.id,
                        kind=STEM_NAME_TO_ASSET_KIND[name],
                        file_path=rel_path,
                    )
                )
            song.status = SongStatus.COMPLETED
            db.commit()
        except Exception:
            db.rollback()
            # 이번 시도에서 실제로 디스크에 쓴 stem만 정리(ORIGINAL은 안 건드림) —
            # written이 비어있으면(ORIGINAL 조회 실패·Demucs 실패 등 쓰기 전 단계)
            # 이 루프는 자연히 no-op.
            for _, rel_path in written:
                p = resolve_asset_path(rel_path)
                if p is not None:
                    p.unlink(missing_ok=True)
            song.status = SongStatus.FAILED
            db.commit()
            raise
        finally:
            if temp_dir is not None:
                shutil.rmtree(temp_dir, ignore_errors=True)
    finally:
        db.close()
