"""T3-2 POST /songs/{id}/transcribe. 근거: REQ-02 경로 A, work/T3-2/plan.md §4."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
from api.deps import get_db
from api.main import app
from auth.security import hash_password
from db.models import Asset, AssetKind, Base, Job, JobStatus, JobType, Song, SongSourceType, User
from db.session import create_sqlite_engine


@pytest.fixture
def db_session():
    engine = create_sqlite_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    yield db
    db.close()


@pytest.fixture
def client(db_session, tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")

    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.dependency_overrides.clear()


def _make_user(db_session, username: str) -> Song:

    user = User(username=username, password_hash=hash_password("pw1234"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client: TestClient, username: str) -> None:
    resp = client.post("/auth/login", json={"username": username, "password": "pw1234"})
    assert resp.status_code == 200


def _make_song_with_stem(db_session, user, with_file: bool = True) -> Song:
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    if with_file:
        file_storage.write_song_file(song.id, "stem_drums.wav", b"fake")
        db_session.add(
            Asset(song_id=song.id, kind=AssetKind.STEM_DRUMS, file_path=f"{song.id}/stem_drums.wav")
        )
        db_session.commit()
    return song


def test_transcribe_requires_login(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem(db_session, user)
    resp = client.post(f"/songs/{song.id}/transcribe")
    assert resp.status_code == 401


def test_transcribe_rejects_when_no_stem_drums_asset(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem(db_session, user, with_file=False)
    _login(client, "u1")

    resp = client.post(f"/songs/{song.id}/transcribe")

    assert resp.status_code == 400


def test_transcribe_rejects_when_stem_file_missing_on_disk(client: TestClient, db_session) -> None:
    """모드C C-006 — Asset 행은 있는데 실제 파일이 없으면 거부."""
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem(db_session, user, with_file=False)
    db_session.add(
        Asset(song_id=song.id, kind=AssetKind.STEM_DRUMS, file_path=f"{song.id}/stem_drums.wav")
    )
    db_session.commit()
    _login(client, "u1")

    resp = client.post(f"/songs/{song.id}/transcribe")

    assert resp.status_code == 400


def test_transcribe_creates_queued_job(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem(db_session, user)
    _login(client, "u1")

    resp = client.post(f"/songs/{song.id}/transcribe")

    assert resp.status_code == 201
    job_id = resp.json()["job_id"]
    job = db_session.get(Job, job_id)
    assert job.job_type == JobType.TRANSCRIBE
    assert job.status == JobStatus.QUEUED
    assert job.song_id == song.id
    assert job.user_id == user.id


def test_other_user_cannot_transcribe_song(client: TestClient, db_session) -> None:
    owner = _make_user(db_session, "owner")
    _make_user(db_session, "other")
    song = _make_song_with_stem(db_session, owner)

    _login(client, "other")
    resp = client.post(f"/songs/{song.id}/transcribe")

    assert resp.status_code == 404
