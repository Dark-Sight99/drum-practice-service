"""T3-1 POST /songs/audio. 근거: REQ-01, REQ-08, work/T3-1/plan.md §2."""

import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
from api.deps import get_db
from api.main import app
from auth.security import hash_password
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


def _make_user(db_session, username: str) -> User:
    user = User(username=username, password_hash=hash_password("pw1234"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client: TestClient, username: str) -> None:
    resp = client.post("/auth/login", json={"username": username, "password": "pw1234"})
    assert resp.status_code == 200


def _upload_audio(
    client: TestClient,
    filename: str = "song.wav",
    title: str = "제목",
    artist: str | None = "아티스트",
    file_bytes: bytes = b"fake-audio-bytes",
):
    data = {"title": title}
    if artist is not None:
        data["artist"] = artist
    files = {"file": (filename, io.BytesIO(file_bytes), "application/octet-stream")}
    return client.post("/songs/audio", data=data, files=files)


def test_upload_requires_login(client: TestClient) -> None:
    resp = _upload_audio(client)
    assert resp.status_code == 401


def test_upload_rejects_unsupported_extension(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    # 2026-10-26 — mp4는 더 이상 거부 대상이 아님(아래 mp4 확장 테스트 참고).
    # 진짜 지원 안 하는 확장자로 교체.
    resp = _upload_audio(client, filename="video.ogg")
    assert resp.status_code == 400


@pytest.mark.parametrize("ext", [".mp3", ".wav", ".m4a", ".flac"])
def test_upload_accepts_req01_extensions(client: TestClient, db_session, ext: str) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    resp = _upload_audio(client, filename=f"song{ext}")
    assert resp.status_code == 201


def test_upload_accepts_mp4(client: TestClient, db_session) -> None:
    # 2026-10-26(의뢰인 요청) — Demucs(ffmpeg 백엔드)가 mp4 비디오 컨테이너에서도
    # 오디오 트랙을 바로 추출해 분리할 수 있음을 이미 확인(qa-evidence/T3-1/
    # demucs_mp4_spike.md) — REQ-01 허용 확장자에 추가.
    _make_user(db_session, "u1")
    _login(client, "u1")

    resp = _upload_audio(client, filename="song.mp4")
    assert resp.status_code == 201


def test_upload_creates_song_original_asset_and_queued_job(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    resp = _upload_audio(client, title="내 곡", artist="아무개", file_bytes=b"x" * 1000)
    assert resp.status_code == 201
    body = resp.json()
    song_id = body["song"]["id"]
    job_id = body["job_id"]

    assert body["song"]["title"] == "내 곡"
    assert body["song"]["artist"] == "아무개"
    assert body["song"]["source_type"] == "audio"
    # REQ-01 "대기·처리중·완료·실패" — 업로드 직후엔 아직 분리 전이라 PENDING.
    assert body["song"]["status"] == "pending"

    song = db_session.get(Song, song_id)
    assert song.source_type == SongSourceType.AUDIO
    assert song.status == SongStatus.PENDING

    original = (
        db_session.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.ORIGINAL)
        .first()
    )
    assert original is not None
    saved_path = file_storage.resolve_asset_path(original.file_path)
    assert saved_path is not None and saved_path.read_bytes() == b"x" * 1000

    job = db_session.get(Job, job_id)
    assert job.job_type == JobType.SEPARATE
    assert job.status == JobStatus.QUEUED
    assert job.song_id == song_id
    assert job.user_id == song.user_id


def test_upload_rejects_oversized_file(client: TestClient, db_session, monkeypatch) -> None:
    import api.songs as songs_module

    monkeypatch.setattr(songs_module, "MAX_AUDIO_UPLOAD_BYTES", 10)
    _make_user(db_session, "u1")
    _login(client, "u1")

    resp = _upload_audio(client, file_bytes=b"0123456789ABCDEF")
    assert resp.status_code == 413
    # 거부된 곡은 DB에 남지 않아야 한다(크기 검사가 Song 생성 전에 끝나거나,
    # 생성됐어도 실패 경로에서 정리됨).
    assert db_session.query(Song).count() == 0


def test_other_user_cannot_access_uploaded_audio_song(client: TestClient, db_session) -> None:
    _make_user(db_session, "owner")
    _make_user(db_session, "other")

    _login(client, "owner")
    resp = _upload_audio(client)
    song_id = resp.json()["song"]["id"]

    _login(client, "other")
    assert client.get(f"/songs/{song_id}").status_code == 404
