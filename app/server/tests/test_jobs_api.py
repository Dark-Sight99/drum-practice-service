"""T1-4 작업 상태 조회 API — 사용자간 격리 테스트. 근거: REQ-10."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.deps import get_db
from api.main import app
from auth.security import hash_password
from db.models import Base, Job, JobType, Song, SongSourceType, User
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
def client(db_session):
    def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.dependency_overrides.clear()


def _make_user(db_session, username: str) -> User:
    user = User(username=username, password_hash=hash_password("pw1234"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _make_song_and_job(db_session, user: User) -> Job:
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    job = Job(user_id=user.id, song_id=song.id, job_type=JobType.SEPARATE)
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def test_jobs_require_login(client: TestClient) -> None:
    assert client.get("/jobs").status_code == 401


def test_user_only_sees_own_jobs(client: TestClient, db_session) -> None:
    u1 = _make_user(db_session, "user1")
    u2 = _make_user(db_session, "user2")
    _make_song_and_job(db_session, u1)
    other_job = _make_song_and_job(db_session, u2)

    client.post("/auth/login", json={"username": "user1", "password": "pw1234"})

    resp = client.get("/jobs")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # REQ-10: 다른 사용자의 작업 상태 조회 시도는 차단(403 아니라 404 — songs.py와 같은 원칙)
    resp = client.get(f"/jobs/{other_job.id}")
    assert resp.status_code == 404
