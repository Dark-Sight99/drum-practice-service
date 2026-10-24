"""T2-5 업로드/이름변경/삭제/DrumScore 조회 API. 근거: REQ-07, REQ-08, work/T2-5/plan.md."""

import io
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
from api.deps import get_db
from api.main import app
from auth.security import hash_password
from db.models import Base, User
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
    # 테스트가 실제 data/songs/를 건드리지 않도록 저장소 루트를 임시 디렉터리로 바꾼다.
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


def _valid_drumscore(bpm: float = 120, ppq: int = 480) -> dict:
    return {
        "version": 1,
        "meta": {"title": "테스트곡", "bpm": bpm, "timeSignature": [4, 4], "source": "midi"},
        "ppq": ppq,
        "audioOffsetMs": 0,
        "notes": [{"tick": 0, "piece": "kick", "velocity": 100, "hand": None}],
    }


def _upload(
    client: TestClient,
    filename: str = "song.mid",
    title: str = "제목",
    artist: str | None = "아티스트",
    drumscore: dict | str | None = None,
    file_bytes: bytes = b"midi-bytes",
):
    if drumscore is None:
        drumscore = _valid_drumscore()
    drumscore_str = drumscore if isinstance(drumscore, str) else json.dumps(drumscore)
    data = {"title": title, "drumscore": drumscore_str}
    if artist is not None:
        data["artist"] = artist
    files = {"file": (filename, io.BytesIO(file_bytes), "application/octet-stream")}
    return client.post("/songs", data=data, files=files)


def test_upload_requires_login(client: TestClient) -> None:
    resp = _upload(client)
    assert resp.status_code == 401


def test_upload_then_list_and_fetch_drumscore(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    resp = _upload(client, title="곡 제목", artist="아티스트명")
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] == "곡 제목"
    assert body["artist"] == "아티스트명"
    assert body["original_bpm"] == 120
    assert body["source_type"] == "midi"
    song_id = body["id"]

    listed = client.get("/songs").json()
    assert len(listed) == 1
    assert listed[0]["id"] == song_id

    score_resp = client.get(f"/songs/{song_id}/drumscore")
    assert score_resp.status_code == 200
    assert score_resp.json() == _valid_drumscore()


def test_other_user_cannot_access_song(client: TestClient, db_session) -> None:
    _make_user(db_session, "owner")
    _make_user(db_session, "other")

    _login(client, "owner")
    song_id = _upload(client).json()["id"]

    _login(client, "other")
    assert client.get(f"/songs/{song_id}").status_code == 404
    assert client.patch(f"/songs/{song_id}", json={"title": "x"}).status_code == 404
    assert client.get(f"/songs/{song_id}/drumscore").status_code == 404
    assert client.delete(f"/songs/{song_id}").status_code == 404


@pytest.mark.parametrize(
    "filename",
    ["song.txt", "song", "song.exe", "song.musicxml.exe"],
)
def test_upload_rejects_disallowed_extension(client: TestClient, db_session, filename) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    resp = _upload(client, filename=filename)
    assert resp.status_code == 400


def test_upload_rejects_oversized_file(client: TestClient, db_session, monkeypatch) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    import api.songs as songs_module

    monkeypatch.setattr(songs_module, "MAX_UPLOAD_BYTES", 10)
    resp = _upload(client, file_bytes=b"x" * 100)
    assert resp.status_code == 413


def test_upload_rejects_malformed_drumscore_json(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    resp = _upload(client, drumscore="{not valid json")
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["meta"].update(bpm=0),
        lambda d: d["meta"].update(bpm=-10),
        lambda d: d.update(ppq=0),
        lambda d: d.update(ppq=-1),
        lambda d: d["meta"].update(timeSignature=[4]),
        lambda d: d["meta"].update(timeSignature=[0, 4]),
        lambda d: d["meta"].update(timeSignature=[4, 0]),
        lambda d: d.update(audioOffsetMs="not-a-number"),
        lambda d: d["notes"][0].update(velocity=200),
        lambda d: d["notes"][0].update(velocity=-1),
        lambda d: d["notes"][0].update(piece="not_a_real_piece"),
        lambda d: d["notes"][0].update(tick=-1),
    ],
)
def test_upload_rejects_invalid_drumscore_invariants(
    client: TestClient, db_session, mutate
) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    score = _valid_drumscore()
    mutate(score)
    resp = _upload(client, drumscore=score)
    assert resp.status_code == 422
    # 고아 Song 행이 안 남아야 함
    assert client.get("/songs").json() == []


def test_upload_rejects_extension_source_mismatch(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    score = _valid_drumscore()
    score["meta"]["source"] = "gp"  # .mid 확장자인데 source는 gp
    resp = _upload(client, filename="song.mid", drumscore=score)
    assert resp.status_code == 400


def test_rename_song(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload(client, title="원래 제목", artist="원래 아티스트").json()["id"]

    resp = client.patch(f"/songs/{song_id}", json={"title": "새 제목"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "새 제목"
    assert body["artist"] == "원래 아티스트"  # artist는 안 건드림

    resp2 = client.patch(f"/songs/{song_id}", json={"artist": None})
    assert resp2.status_code == 200
    assert resp2.json()["artist"] is None


def test_rename_rejects_empty_title(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload(client).json()["id"]
    resp = client.patch(f"/songs/{song_id}", json={"title": ""})
    assert resp.status_code == 422


def test_delete_song_removes_files(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload(client).json()["id"]

    song_dir = file_storage.SONGS_ROOT / str(song_id)
    assert song_dir.exists()
    assert list(song_dir.iterdir())

    resp = client.delete(f"/songs/{song_id}")
    assert resp.status_code == 204
    assert client.get(f"/songs/{song_id}").status_code == 404
    assert not song_dir.exists()


def test_resolve_asset_path_blocks_traversal(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")
    file_storage.SONGS_ROOT.mkdir(parents=True)
    assert file_storage.resolve_asset_path("../../etc/passwd") is None
    assert file_storage.resolve_asset_path("/etc/passwd") is None
    assert file_storage.resolve_asset_path("1/../../2/drumscore.json") is None
    # 정상 경로는 허용
    assert file_storage.resolve_asset_path("1/drumscore.json") is not None
