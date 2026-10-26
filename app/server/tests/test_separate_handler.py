"""T3-1 JobType.SEPARATE 핸들러. 근거: REQ-01, work/T3-1/plan.md §3.

separate_handler는 Callable[[Job], None] 시그니처라 자기 세션을 직접 연다
(db.session.SessionLocal()) — 테스트는 db.session.SessionLocal을 StaticPool로
공유된 in-memory 엔진의 sessionmaker로 monkeypatch해서, 테스트 픽스처의 db와
핸들러 내부 세션이 같은 데이터를 보게 한다.
"""

from pathlib import Path

import pytest
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import db.session as db_session_module
import file_storage
from db.models import (
    Asset,
    AssetKind,
    Base,
    Job,
    JobStatus,
    JobType,
    Song,
    SongSourceType,
    SongStatus,
    User,
)
from db.session import create_sqlite_engine
from modules.separator import handler as handler_module
from modules.separator.demucs_separator import SeparationError


@pytest.fixture
def db(monkeypatch, tmp_path):
    engine = create_sqlite_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestSessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(db_session_module, "SessionLocal", TestSessionLocal)
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")

    session = TestSessionLocal()
    yield session
    session.close()


def _make_user_song_job(db) -> tuple[User, Song, Job]:
    user = User(username="u1", password_hash="x")
    db.add(user)
    db.commit()
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db.add(song)
    db.commit()
    file_storage.write_song_file(song.id, "original.wav", b"fake-audio")
    db.add(Asset(song_id=song.id, kind=AssetKind.ORIGINAL, file_path=f"{song.id}/original.wav"))
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    db.commit()
    return user, song, job


def _fake_encode_mp3(wav_path: Path) -> bytes:
    return f"mp3-{wav_path.name}".encode()


def test_separate_handler_success_creates_four_stem_assets(db, monkeypatch, tmp_path) -> None:
    _, song, job = _make_user_song_job(db)

    def fake_separate(input_path: Path, output_dir: Path, device=None):
        stems = {}
        for name in ("drums", "bass", "other", "vocals"):
            p = output_dir / f"{name}.wav"
            p.write_bytes(f"stem-{name}".encode())
            stems[name] = p
        return stems

    monkeypatch.setattr(handler_module, "separate", fake_separate)
    monkeypatch.setattr(handler_module, "encode_mp3", _fake_encode_mp3)

    handler_module.separate_handler(job)

    db.refresh(song)
    # T3-19 — 분리 성공만으로는 COMPLETED가 되지 않음(채보까지 자동으로 이어지므로
    # PROCESSING에 머무름) — 별도 테스트(test_separate_handler_success_queues_transcribe_job)
    # 참고.
    assert song.status == SongStatus.PROCESSING
    stems = db.query(Asset).filter(Asset.song_id == song.id, Asset.kind != AssetKind.ORIGINAL).all()
    assert {a.kind for a in stems} == {
        AssetKind.STEM_DRUMS,
        AssetKind.STEM_BASS,
        AssetKind.STEM_OTHER,
        AssetKind.STEM_VOCALS,
    }
    for asset in stems:
        path = file_storage.resolve_asset_path(asset.file_path)
        assert path is not None and path.exists()
        # T3-16-feedback — drums만 WAV 그대로, 나머지 셋은 MP3로 저장돼야 함
        # (채보 파이프라인이 drums WAV를 직접 읽으므로 손대지 않음).
        if asset.kind == AssetKind.STEM_DRUMS:
            assert path.suffix == ".wav"
            # T3-16-feedback-2 — drums Asset은 WAV 그대로지만, 옆에 재생용
            # MP3 사이드카(Asset으로 등록되지 않음)도 같이 생겨야 한다.
            sidecar = path.with_suffix(".mp3")
            assert sidecar.exists()
        else:
            assert path.suffix == ".mp3"


def test_separate_handler_success_queues_transcribe_job(db, monkeypatch) -> None:
    """T3-19(2026-10-26) — 종이 악보 경로 드롭으로 "분리 뒤 수동 트리거" 사유가
    없어져, 분리 성공 시 TRANSCRIBE 작업을 자동으로 큐에 넣는다."""
    _, song, job = _make_user_song_job(db)

    def fake_separate(input_path: Path, output_dir: Path, device=None):
        stems = {}
        for name in ("drums", "bass", "other", "vocals"):
            p = output_dir / f"{name}.wav"
            p.write_bytes(f"stem-{name}".encode())
            stems[name] = p
        return stems

    monkeypatch.setattr(handler_module, "separate", fake_separate)
    monkeypatch.setattr(handler_module, "encode_mp3", _fake_encode_mp3)

    handler_module.separate_handler(job)

    transcribe_jobs = (
        db.query(Job)
        .filter(Job.song_id == song.id, Job.job_type == JobType.TRANSCRIBE)
        .all()
    )
    assert len(transcribe_jobs) == 1
    assert transcribe_jobs[0].status == JobStatus.QUEUED
    assert transcribe_jobs[0].user_id == song.user_id


def test_separate_handler_failure_does_not_queue_transcribe_job(db, monkeypatch) -> None:
    _, song, job = _make_user_song_job(db)

    def failing_separate(input_path: Path, output_dir: Path, device=None):
        raise SeparationError("데모 중 터진 에러")

    monkeypatch.setattr(handler_module, "separate", failing_separate)

    with pytest.raises(SeparationError):
        handler_module.separate_handler(job)

    transcribe_jobs = (
        db.query(Job)
        .filter(Job.song_id == song.id, Job.job_type == JobType.TRANSCRIBE)
        .all()
    )
    assert transcribe_jobs == []


def test_separate_handler_succeeds_even_if_drums_mp3_sidecar_encode_fails(
    db, monkeypatch
) -> None:
    """T3-16-feedback-2 — 사이드카는 재생 최적화일 뿐이라, 생성이 실패해도
    Song 처리 전체는 COMPLETED로 끝나야 한다(기존 WAV로 그냥 서빙됨)."""
    _, song, job = _make_user_song_job(db)

    def fake_separate(input_path: Path, output_dir: Path, device=None):
        stems = {}
        for name in ("drums", "bass", "other", "vocals"):
            p = output_dir / f"{name}.wav"
            p.write_bytes(f"stem-{name}".encode())
            stems[name] = p
        return stems

    def flaky_encode_mp3(wav_path: Path) -> bytes:
        if wav_path.name == "drums.wav":
            raise RuntimeError("ffmpeg 일시 오류 시뮬레이션")
        return _fake_encode_mp3(wav_path)

    monkeypatch.setattr(handler_module, "separate", fake_separate)
    monkeypatch.setattr(handler_module, "encode_mp3", flaky_encode_mp3)

    handler_module.separate_handler(job)

    db.refresh(song)
    # T3-19 — 분리 성공만으로는 COMPLETED가 되지 않음(위 테스트와 같은 사유).
    assert song.status == SongStatus.PROCESSING
    drums_asset = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind.STEM_DRUMS)
        .first()
    )
    path = file_storage.resolve_asset_path(drums_asset.file_path)
    assert path is not None and path.exists()  # WAV는 정상 존재
    assert not path.with_suffix(".mp3").exists()  # 사이드카만 없음


def test_separate_handler_demucs_failure_marks_song_failed_and_reraises(db, monkeypatch) -> None:
    _, song, job = _make_user_song_job(db)

    def fake_separate(input_path: Path, output_dir: Path, device=None):
        raise SeparationError("demucs 실패")

    monkeypatch.setattr(handler_module, "separate", fake_separate)

    with pytest.raises(SeparationError):
        handler_module.separate_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.FAILED


def test_separate_handler_cleans_up_only_stems_written_this_attempt_on_partial_failure(
    db, monkeypatch
) -> None:
    """모드C C-002/C-011 — stem 쓰기 일부 성공 후 실패하면 이번 시도에서 쓴
    stem만 지우고 ORIGINAL은 그대로 남아야 한다."""
    _, song, job = _make_user_song_job(db)

    def fake_separate(input_path: Path, output_dir: Path, device=None):
        stems = {}
        for name in ("drums", "bass", "other", "vocals"):
            p = output_dir / f"{name}.wav"
            p.write_bytes(b"x")
            stems[name] = p
        return stems

    monkeypatch.setattr(handler_module, "separate", fake_separate)
    monkeypatch.setattr(handler_module, "encode_mp3", _fake_encode_mp3)

    real_write = file_storage.write_song_file
    call_count = {"n": 0}

    def flaky_write(song_id, fixed_filename, content):
        call_count["n"] += 1
        if call_count["n"] == 3:  # 4개 중 3번째에서 실패
            raise OSError("디스크 오류 시뮬레이션")
        return real_write(song_id, fixed_filename, content)

    monkeypatch.setattr(handler_module, "write_song_file", flaky_write)

    with pytest.raises(OSError):
        handler_module.separate_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.FAILED
    # ORIGINAL 파일·에셋은 그대로 남아있어야 함
    original = (
        db.query(Asset).filter(Asset.song_id == song.id, Asset.kind == AssetKind.ORIGINAL).first()
    )
    assert original is not None
    assert file_storage.resolve_asset_path(original.file_path).exists()
    # stem Asset은 하나도 커밋되지 않아야 함(쓰기 도중 실패 → DB 반영 전)
    stem_assets = (
        db.query(Asset).filter(Asset.song_id == song.id, Asset.kind != AssetKind.ORIGINAL).all()
    )
    assert stem_assets == []
    # 이번 시도에서 먼저 쓴 2개(drums.wav, bass.mp3)도 디스크에 안 남아있어야 함
    # — stems.items() 순서(drums,bass,other,vocals)대로 write_song_file이
    # 호출되고 3번째(other) 호출에서 실패하므로, 성공한 건 drums·bass뿐.
    for rel_path in (f"{song.id}/stem_drums.wav", f"{song.id}/stem_bass.mp3"):
        p = file_storage.resolve_asset_path(rel_path)
        assert p is None or not p.exists()


def test_separate_handler_missing_original_asset_fails_cleanly(db) -> None:
    user = User(username="u2", password_hash="x")
    db.add(user)
    db.commit()
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db.add(song)
    db.commit()
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db.add(job)
    db.commit()

    with pytest.raises(RuntimeError):
        handler_module.separate_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.FAILED
