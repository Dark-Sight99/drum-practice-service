"""T3-2 JobType.TRANSCRIBE 핸들러. 근거: REQ-02 경로 A, work/T3-2/plan.md §3.

T3-1 test_separate_handler.py와 같은 DB 세션 monkeypatch 패턴(transcribe_handler도
Callable[[Job], None] 시그니처라 자기 세션을 직접 엶).
"""

from pathlib import Path

import pretty_midi
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
    JobType,
    Song,
    SongSourceType,
    SongStatus,
    User,
)
from db.session import create_sqlite_engine
from modules.transcriber import handler as handler_module
from modules.transcriber.adtof_transcriber import TranscriptionError


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


def _make_song_with_drums_stem(db) -> tuple[User, Song, Job]:
    user = User(username="u1", password_hash="x")
    db.add(user)
    db.commit()
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db.add(song)
    db.commit()
    file_storage.write_song_file(song.id, "stem_drums.wav", b"fake-drums-audio")
    db.add(Asset(song_id=song.id, kind=AssetKind.STEM_DRUMS, file_path=f"{song.id}/stem_drums.wav"))
    db.commit()
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job)
    db.commit()
    return user, song, job


def _fake_transcribe_writing_midi(pitches: list[int]):
    def _fake(input_path: Path, output_path: Path, device=None):
        midi = pretty_midi.PrettyMIDI(resolution=220, initial_tempo=120.0)
        inst = pretty_midi.Instrument(program=1, is_drum=True)
        for i, pitch in enumerate(pitches):
            inst.notes.append(
                pretty_midi.Note(velocity=100, pitch=pitch, start=i * 0.5, end=i * 0.5 + 0.1)
            )
        midi.instruments.append(inst)
        midi.write(str(output_path))

    return _fake


def test_transcribe_handler_success_creates_drumscore_raw_asset(db, monkeypatch) -> None:
    _, song, job = _make_song_with_drums_stem(db)
    monkeypatch.setattr(
        handler_module, "transcribe", _fake_transcribe_writing_midi([35, 38, 42, 47, 49])
    )

    handler_module.transcribe_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.COMPLETED
    raw = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind.DRUMSCORE_RAW)
        .all()
    )
    assert len(raw) == 1
    path = file_storage.resolve_asset_path(raw[0].file_path)
    assert path is not None and path.exists()
    assert path.name == "drumscore.json"
    # 스테이징 파일은 승격 후 안 남아있어야 함
    assert not (path.parent / "drumscore.json.new").exists()


def test_transcribe_handler_re_run_does_not_duplicate_raw_asset(db, monkeypatch) -> None:
    """모드C C-002 회귀 테스트 — 재채보해도 DRUMSCORE_RAW 행이 1개만 있어야 함."""
    _, song, job = _make_song_with_drums_stem(db)
    monkeypatch.setattr(handler_module, "transcribe", _fake_transcribe_writing_midi([35, 38]))
    handler_module.transcribe_handler(job)

    # 같은 곡에 두 번째 채보 작업
    job2 = Job(user_id=song.user_id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job2)
    db.commit()
    monkeypatch.setattr(
        handler_module, "transcribe", _fake_transcribe_writing_midi([35, 38, 47])
    )
    handler_module.transcribe_handler(job2)

    raw = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind.DRUMSCORE_RAW)
        .all()
    )
    assert len(raw) == 1  # 중복 생성 안 됨
    content = file_storage.resolve_asset_path(raw[0].file_path).read_text(encoding="utf-8")
    assert "tom_mid" in content  # 두 번째(최신) 채보 내용으로 교체됐어야 함


def test_transcribe_handler_preserves_edited_asset_and_get_prefers_it(db, monkeypatch) -> None:
    """모드C C-004 확인 — DRUMSCORE_EDITED가 있으면 재채보해도 그건 안 건드림
    (GET이 EDITED를 우선 반환하는 건 api/songs.py 책임이라 여기선 EDITED
    에셋/파일 자체가 그대로인지만 확인)."""
    _, song, job = _make_song_with_drums_stem(db)
    edited_content = (
        b'{"version":1,"meta":{"title":"edited","bpm":100,"timeSignature":[4,4],'
        b'"source":"audio"},"ppq":220,"audioOffsetMs":0,"notes":[]}'
    )
    file_storage.write_song_file(song.id, "drumscore_edited.json", edited_content)
    db.add(
        Asset(
            song_id=song.id,
            kind=AssetKind.DRUMSCORE_EDITED,
            file_path=f"{song.id}/drumscore_edited.json",
        )
    )
    db.commit()

    monkeypatch.setattr(handler_module, "transcribe", _fake_transcribe_writing_midi([35]))
    handler_module.transcribe_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.COMPLETED
    edited_path = file_storage.resolve_asset_path(f"{song.id}/drumscore_edited.json")
    assert edited_path.read_bytes() == edited_content  # 전혀 안 바뀜


def test_transcribe_handler_adtof_failure_marks_song_failed_and_preserves_old_raw(
    db, monkeypatch
) -> None:
    """모드C C-003 — 기존에 성공한 RAW가 있는 상태에서 재채보가 실패하면,
    기존 drumscore.json은 그대로 남아야 한다(스테이징이 승격되지 않으므로)."""
    _, song, job = _make_song_with_drums_stem(db)
    monkeypatch.setattr(handler_module, "transcribe", _fake_transcribe_writing_midi([35, 38]))
    handler_module.transcribe_handler(job)
    raw = (
        db.query(Asset)
        .filter(Asset.song_id == song.id, Asset.kind == AssetKind.DRUMSCORE_RAW)
        .first()
    )
    old_content = file_storage.resolve_asset_path(raw.file_path).read_bytes()

    job2 = Job(user_id=song.user_id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job2)
    db.commit()

    def _boom(input_path, output_path, device=None):
        raise TranscriptionError("ADTOF 실패 시뮬레이션")

    monkeypatch.setattr(handler_module, "transcribe", _boom)

    with pytest.raises(TranscriptionError):
        handler_module.transcribe_handler(job2)

    db.refresh(song)
    assert song.status == SongStatus.FAILED
    raw_path = file_storage.resolve_asset_path(raw.file_path)
    assert raw_path.read_bytes() == old_content  # 기존 파일 그대로 보존
    # 스테이징 파일도 정리됐어야 함
    assert not (raw_path.parent / "drumscore.json.new").exists()


def test_transcribe_handler_invalid_drumscore_fails_cleanly(db, monkeypatch) -> None:
    """midi_to_drumscore가 DrumScoreIn 검증을 통과 못 하는 값을 만들면(버그
    시뮬레이션), Song.FAILED로 끝나야지 크래시하면 안 됨."""
    _, song, job = _make_song_with_drums_stem(db)
    monkeypatch.setattr(handler_module, "transcribe", _fake_transcribe_writing_midi([35]))
    invalid_drumscore = {"version": 1, "meta": {}, "notes": [], "ppq": -1, "audioOffsetMs": 0}
    monkeypatch.setattr(
        handler_module,
        "midi_to_drumscore",
        lambda midi, title: (invalid_drumscore, 0),
    )

    with pytest.raises(Exception):  # noqa: B017 — pydantic ValidationError, 구체 타입은 구현 세부사항
        handler_module.transcribe_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.FAILED


def test_transcribe_handler_missing_stem_drums_fails_cleanly(db) -> None:
    user = User(username="u2", password_hash="x")
    db.add(user)
    db.commit()
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db.add(song)
    db.commit()
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.TRANSCRIBE)
    db.add(job)
    db.commit()

    with pytest.raises(RuntimeError):
        handler_module.transcribe_handler(job)

    db.refresh(song)
    assert song.status == SongStatus.FAILED
