"""JobType.TRANSCRIBE 작업 핸들러. 근거: REQ-02 경로 A, work/T3-2/plan.md §3.

구현은 plan.md §3의 확정 설계(스테이징 후 승격)를 그대로 따른다 — 변경 시
plan.md도 같이 갱신할 것.
"""

import logging
import os
import tempfile
import time
from pathlib import Path

import pretty_midi

from api.schemas import DrumScoreIn
from db import session as db_session
from db.models import Asset, AssetKind, Job, Song, SongStatus
from file_storage import resolve_asset_path, write_song_file
from modules.transcriber.adtof_transcriber import transcribe
from modules.transcriber.midi_to_drumscore import midi_to_drumscore
from modules.transcriber.tempo import estimate_tempo

logger = logging.getLogger("worker.transcribe")

DRUMSCORE_FILENAME = "drumscore.json"
STAGING_FILENAME = "drumscore.json.new"


def _stem_drums_path(db, song_id: int) -> Path:
    asset = (
        db.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.STEM_DRUMS)
        .first()
    )
    if asset is None:
        raise RuntimeError(f"song={song_id}에 STEM_DRUMS 에셋이 없습니다(T3-1 분리가 선행돼야 함)")
    path = resolve_asset_path(asset.file_path)
    if path is None or not path.exists():
        raise RuntimeError(f"song={song_id}의 드럼 스템 파일을 찾을 수 없습니다: {asset.file_path}")
    return path


def _find_raw_asset(db, song_id: int) -> Asset | None:
    return (
        db.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.DRUMSCORE_RAW)
        .first()
    )


def transcribe_handler(job: Job) -> None:
    # T3-1 separate_handler와 같은 이유로 db.session을 모듈로 import해서 호출
    # (monkeypatch.setattr(db.session, "SessionLocal", ...)가 반영되려면 이름을
    # 미리 바인딩하면 안 됨).
    db = db_session.SessionLocal()
    try:
        song = db.get(Song, job.song_id)
        if song is None:
            raise RuntimeError(f"job={job.id}의 song={job.song_id}을 찾을 수 없습니다")

        song.status = SongStatus.PROCESSING
        db.commit()

        staging_rel_path: str | None = None
        tmp_midi_path: str | None = None
        try:
            drums_path = _stem_drums_path(db, song.id)

            fd, tmp_midi_path = tempfile.mkstemp(suffix=".mid")
            os.close(fd)  # ADTOF가 --out 경로에 직접 쓰므로 이 fd로는 안 씀
            tmp_midi = Path(tmp_midi_path)

            start = time.monotonic()
            transcribe(drums_path, tmp_midi)
            elapsed = time.monotonic() - start
            logger.info("transcribe song=%s elapsed=%.1fs device_auto=yes", song.id, elapsed)

            # 2026-10-27(의뢰인 발견, Q-40) — ADTOF는 템포를 전혀 추정하지
            # 않아(온셋 분류 모델일 뿐) 지금까지 모든 음원 업로드 곡이 실제
            # 템포와 무관하게 pretty_midi 기본값(120)으로 저장돼왔다. 드럼
            # 스템에서 직접 템포를 추정해(실패해도 안전하게 DEFAULT_BPM로
            # 폴백) 넘긴다.
            bpm = estimate_tempo(drums_path)
            logger.info("transcribe song=%s estimated_bpm=%.2f", song.id, bpm)

            midi = pretty_midi.PrettyMIDI(str(tmp_midi))
            drumscore_dict, unmapped_count = midi_to_drumscore(midi, title=song.title, bpm=bpm)
            if unmapped_count:
                logger.info(
                    "transcribe song=%s unmapped_pitch_count=%d", song.id, unmapped_count
                )

            # DrumScoreIn으로 검증(T1-5가 예정해둔 "Python 생성 로직 교차검증") —
            # 실패하면 우리 변환 로직의 버그이지 사용자 입력 문제가 아니므로 그대로
            # 예외를 전파한다.
            validated = DrumScoreIn.model_validate(drumscore_dict)
            content = validated.model_dump_json().encode("utf-8")

            # 스테이징 후 승격(모드C C-003) — 기존 drumscore.json은 DB 커밋이
            # 확정된 뒤에만 교체한다. 재채보든 최초 채보든 동일하게 보호됨.
            staging_rel_path = write_song_file(song.id, STAGING_FILENAME, content)

            existing_raw = _find_raw_asset(db, song.id)
            if existing_raw is None:
                db.add(
                    Asset(
                        song_id=song.id,
                        kind=AssetKind.DRUMSCORE_RAW,
                        file_path=f"{song.id}/{DRUMSCORE_FILENAME}",
                    )
                )
            song.status = SongStatus.COMPLETED
            db.commit()

            staging_path = resolve_asset_path(staging_rel_path)
            final_path = resolve_asset_path(f"{song.id}/{DRUMSCORE_FILENAME}")
            staging_path.replace(final_path)
            staging_rel_path = None  # 승격 성공 — 더 이상 정리 대상 아님
        except Exception:
            db.rollback()
            # 모드A 지적 C-002: 스테이징 정리 자체가 실패해도(예: 파일 잠김)
            # 아래 Song.FAILED 커밋은 반드시 실행돼야 한다 — 정리 실패가 상태
            # 기록을 막으면 Song이 PROCESSING에 남아버린다. 정리 실패는 로그만
            # 남기고 원래 예외(아래 raise)를 그대로 올린다.
            if staging_rel_path is not None:
                try:
                    p = resolve_asset_path(staging_rel_path)
                    if p is not None:
                        p.unlink(missing_ok=True)
                except OSError:
                    logger.warning(
                        "transcribe song=%s 스테이징 파일 정리 실패(무시하고 계속)", song.id
                    )
            song.status = SongStatus.FAILED
            db.commit()
            raise
        finally:
            if tmp_midi_path is not None:
                Path(tmp_midi_path).unlink(missing_ok=True)
    finally:
        db.close()
