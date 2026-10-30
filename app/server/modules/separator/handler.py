"""JobType.SEPARATE 작업 핸들러. 근거: REQ-01, REQ-10, work/T3-1/plan.md §3.

구현은 plan.md §3의 확정 의사코드를 그대로 따른다 — 변경 시 plan.md도 같이 갱신할 것.
"""

import logging
import shutil
import tempfile
import time
from pathlib import Path

from db import session as db_session
from db.models import Asset, AssetKind, Job, JobType, Song, SongStatus
from file_storage import resolve_asset_path, write_song_file
from modules.separator.demucs_separator import (
    apply_gain,
    compute_playback_gain,
    encode_mp3,
    mix_stems,
    separate,
)

logger = logging.getLogger("worker.separate")

# T6-3(REQ-06, Q-33) — bass/other/vocals는 더 이상 개별 Asset으로 안 만들고
# mix_stems()로 합쳐 "music"이라는 이름으로 STEM_MUSIC Asset 하나를 만든다
# (work/T6-3/plan.md) — 아래 `written` 리스트가 "drums"/"music" 두 이름만
# 담게 되므로 이 매핑도 그 둘만 있으면 됨.
STEM_NAME_TO_ASSET_KIND: dict[str, AssetKind] = {
    "drums": AssetKind.STEM_DRUMS,
    "music": AssetKind.STEM_MUSIC,
}
# T6-3 — "음악" 묶음(UI에서 이미 슬라이더 하나로 묶여 있음, T3-8,
# app/web/src/audio/mixer.ts MUSIC_STEM_KEYS와 이름 순서를 맞춤 — 순서 자체는
# amix에서 무관하지만 가독성을 위해 맞춤).
MUSIC_STEM_NAMES = ("bass", "vocals", "other")


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
        sidecar_written: list[str] = []
        try:
            original_path = _original_asset_path(db, song.id)
            temp_dir = Path(tempfile.mkdtemp(prefix=f"separate_{song.id}_"))

            start = time.monotonic()
            stems = separate(original_path, temp_dir)
            elapsed = time.monotonic() - start
            logger.info("separate song=%s elapsed=%.1fs device_auto=yes", song.id, elapsed)

            # 2026-10-27(의뢰인 요청) — "곡마다 믹서 100%일 때 음량이 달라
            # 매번 다시 맞춰야 한다"는 불편 해소. 원곡 전체 믹스의 RMS를 기준
            # 게인 하나로 계산해(demucs_separator.compute_playback_gain) 스템
            # 4개 전부에 그대로 적용 — 이미 거치는 인코딩/저장 단계에 끼워
            # 넣는 것이라 재인코딩이 추가로 생기지 않는다(음질 손실 없음).
            gain_linear = compute_playback_gain(original_path, stems.values())
            logger.info("song=%s playback_gain=%.3fx", song.id, gain_linear)

            # T3-16-feedback(네트워크 스트리밍) — drums는 T3-2 채보 파이프라인이
            # 그대로 읽으므로(librosa, WAV 입력 전제로 검증됨) 손대지 않고 WAV
            # 그대로 저장한다.
            rel_path = write_song_file(
                song.id, "stem_drums.wav", apply_gain(stems["drums"], gain_linear)
            )
            written.append(("drums", rel_path))

            # T6-3(REQ-06, Q-33 원인 확정) — bass/other/vocals는 "음악" 묶음으로
            # 항상 셋이 동시에 재생되는데(UI도 이미 슬라이더 하나로 묶음, T3-8),
            # 이 3개를 개별 <audio> 엘리먼트로 동시 디코딩하는 게 모바일 CPU를
            # 다 써 fps를 떨어뜨리는 게 실기기로 확정됨(Q-33). 서버에서 미리
            # 하나로 섞어 저장 — 동시 재생 스트림이 4개→2개(드럼+음악)로
            # 줄어든다(work/T6-3/plan.md). mix_stems()가 자체적으로 합산 후
            # 피크를 재측정해 클리핑도 막는다.
            music_rel_path = write_song_file(
                song.id,
                "stem_music.mp3",
                mix_stems(
                    [stems[name] for name in MUSIC_STEM_NAMES], gain_linear=gain_linear
                ),
            )
            written.append(("music", music_rel_path))

            # T3-16-feedback-2(네트워크 스트리밍) — stem_drums.wav(38.7MB)는
            # Asset으로는 그대로 두되(채보 파이프라인이 이 경로를 읽음, 위
            # 주석 참고), 재생 전용 MP3 사본을 "같은 이름.mp3"로 옆에 하나 더
            # 만들어둔다. `songs.py`의 서빙 엔드포인트가 이 사본이 있으면
            # 우선 서빙한다(아래 songs.py 변경) — 맥에서 실측한 결과 압축한
            # bass/other/vocals는 한 번에 깔끔히 받아졌는데, 압축 안 한
            # stem_drums.wav만 같은 38.7MB 범위를 반복·중도취소하며 재요청하는
            # 패턴이 네트워크 탭에서 확인됨. Asset이 아니라 사이드카 파일이라
            # 실패해도(ffmpeg 일시 오류 등) Song 처리 전체를 실패시키지 않음
            # — 재생 최적화일 뿐, 없으면 그냥 기존 WAV로 서빙될 뿐 기능 자체는
            # 안 깨짐.
            try:
                sidecar_rel = write_song_file(
                    song.id,
                    "stem_drums.mp3",
                    encode_mp3(stems["drums"], gain_linear=gain_linear),
                )
                sidecar_written.append(sidecar_rel)
            except Exception:
                logger.warning(
                    "song=%s stem_drums 재생용 MP3 사이드카 생성 실패(기능에는 영향 없음)",
                    song.id,
                    exc_info=True,
                )
            for name, rel_path in written:
                db.add(
                    Asset(
                        song_id=song.id,
                        kind=STEM_NAME_TO_ASSET_KIND[name],
                        file_path=rel_path,
                    )
                )
            # T3-19(2026-10-26, 의뢰인 결정) — 종이 악보(Phase 4) 경로가 드롭되면서
            # "분리 뒤 악보를 추가로 올릴 기회를 준다"던 수동 트리거 사유(work/T3-2/
            # plan.md "T3-1과의 관계" #2)가 없어져, 분리가 끝나면 채보(TRANSCRIBE)
            # 작업을 자동으로 큐에 넣는다. Song.status는 COMPLETED로 올리지
            # **않고** PROCESSING에 그대로 둔다(Codex 모드A 지적 Medium 반영 —
            # 처음엔 COMPLETED로 커밋했다가 TRANSCRIBE가 시작되기 전까지 "완료"로
            # 보이는 짧은 구간이 있었는데, 그 사이 사용자가 곡을 열면 아직 없는
            # DrumScore를 조회하다 에러가 난다는 걸 실제로 지적받음 — 단순
            # 깜빡임이 아니라 진짜 버그였음). `_sync_song_status_with_job()`
            # 안전망도 "이 곡에 대기 중인 다른 작업이 있으면 그대로 둔다"로 같이
            # 고쳐서, 여기서 PROCESSING으로 남겨둬도 그 안전망이 오작동하지
            # 않는다(worker/runner.py 참고). 채보가 끝나야 비로소 COMPLETED.
            db.add(Job(user_id=song.user_id, song_id=song.id, job_type=JobType.TRANSCRIBE))
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
            for rel_path in sidecar_written:
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
