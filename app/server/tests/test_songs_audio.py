"""T3-3 GET /songs/{id}/audio/{kind}. 근거: REQ-04, work/T3-3/plan.md §1.

소유권·존재 여부 검사는 기존 `get_owned_song`/`resolve_asset_path` 패턴을
그대로 재사용하므로(test_songs_transcribe_api.py와 같은 형태) 여기서는 그
재사용이 실제로 맞물려 동작하는지만 엔드포인트 단위로 검증한다. Range 요청
처리는 "Starlette 소스를 읽어봤다"로 끝내지 않고 실제 TestClient 요청-응답으로
직접 확인한다(work/T3-3/plan.md §QA계획 2 — 모드C 1라운드 MINOR 반영).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
from api.deps import get_db
from api.main import app
from auth.security import hash_password
from db.models import Asset, AssetKind, Base, Song, SongSourceType, User
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


def _make_song_with_audio(db_session, user, content: bytes = b"fake-wav-bytes") -> Song:
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    file_storage.write_song_file(song.id, "stem_drums.wav", content)
    db_session.add(
        Asset(song_id=song.id, kind=AssetKind.STEM_DRUMS, file_path=f"{song.id}/stem_drums.wav")
    )
    db_session.commit()
    return song


def test_get_audio_requires_login(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user)
    resp = client.get(f"/songs/{song.id}/audio/stem_drums")
    assert resp.status_code == 401


def test_get_audio_returns_file_bytes(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user, content=b"hello-wav")
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 200
    assert resp.content == b"hello-wav"
    assert resp.headers["accept-ranges"] == "bytes"


def test_get_audio_sets_long_lived_immutable_cache_control(client: TestClient, db_session) -> None:
    """T3-16-feedback-5 — 이 song_id/kind 조합의 파일은 재분리 엔드포인트가
    없어 절대 안 바뀌므로, 브라우저가 매 재생마다 재검증 왕복 없이 오래
    캐시해도 안전하다(원격 네트워크에서 재생 중 왕복 자체를 없애는 목적)."""
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_get_audio_supports_range_requests(client: TestClient, db_session) -> None:
    """모드C 1라운드 MINOR — Range 지원을 소스 열람이 아니라 실제 요청-응답으로
    확정한다."""
    user = _make_user(db_session, "u1")
    content = b"0123456789"
    song = _make_song_with_audio(db_session, user, content=content)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums", headers={"Range": "bytes=2-5"})

    assert resp.status_code == 206
    assert resp.content == content[2:6]
    assert resp.headers["content-range"] == f"bytes 2-5/{len(content)}"


def test_get_audio_prefers_mp3_sidecar_over_wav_asset(client: TestClient, db_session) -> None:
    """T3-16-feedback-2 — 등록된 Asset은 WAV(stem_drums, 채보 파이프라인용)지만
    재생 전용 MP3 사이드카가 옆에 있으면(핸들러가 best-effort로 생성) 그걸
    대신 서빙해야 한다. Asset.file_path는 그대로 WAV를 가리킨다(채보가 영향
    안 받음을 확인하는 게 목적이 아니라, 서빙만 사이드카를 쓰는지 확인)."""
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user, content=b"original-wav-bytes")
    file_storage.write_song_file(song.id, "stem_drums.mp3", b"sidecar-mp3-bytes")
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 200
    assert resp.content == b"sidecar-mp3-bytes"
    assert resp.headers["content-type"] == "audio/mpeg"


def test_get_audio_falls_back_to_wav_when_no_sidecar(client: TestClient, db_session) -> None:
    """사이드카가 없으면(아직 생성 안 됐거나 생성 실패) 기존 WAV를 그대로
    서빙 — 기능이 깨지지 않아야 한다."""
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user, content=b"original-wav-bytes")
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 200
    assert resp.content == b"original-wav-bytes"
    assert resp.headers["content-type"] == "audio/wav"


def test_get_audio_404_when_asset_row_missing(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 404


def test_get_audio_404_when_file_missing_on_disk(client: TestClient, db_session) -> None:
    """Asset 행은 있는데 실제 파일이 없는 경우 — 기존 transcribe_song의 모드C
    C-006 방어 패턴 재사용."""
    user = _make_user(db_session, "u1")
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    db_session.add(
        Asset(song_id=song.id, kind=AssetKind.STEM_DRUMS, file_path=f"{song.id}/stem_drums.wav")
    )
    db_session.commit()
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 404


def test_get_audio_rejects_non_audio_kind(client: TestClient, db_session) -> None:
    """DRUMSCORE_RAW 등은 AudioAssetKind에 없어 경로 자체에서 422."""
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/drumscore_raw")

    assert resp.status_code == 422


def test_other_user_cannot_get_audio(client: TestClient, db_session) -> None:
    owner = _make_user(db_session, "owner")
    _make_user(db_session, "other")
    song = _make_song_with_audio(db_session, owner)

    _login(client, "other")
    resp = client.get(f"/songs/{song.id}/audio/stem_drums")

    assert resp.status_code == 404


def test_song_out_includes_available_audio_kinds(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_audio(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}")

    assert resp.status_code == 200
    assert resp.json()["available_audio_kinds"] == ["stem_drums"]


def test_song_out_empty_audio_kinds_when_not_separated(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}")

    assert resp.json()["available_audio_kinds"] == []
