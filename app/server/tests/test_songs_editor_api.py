"""T2-6 PUT /songs/{id}/drumscore(편집본 저장) API. 근거: REQ-03, REQ-08, work/T2-6/plan.md."""

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
from db.models import Asset, AssetKind, Base, User
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


def _valid_drumscore(bpm: float = 120, ppq: int = 480) -> dict:
    return {
        "version": 1,
        "meta": {"title": "테스트곡", "bpm": bpm, "timeSignature": [4, 4], "source": "midi"},
        "ppq": ppq,
        "audioOffsetMs": 0,
        "notes": [{"tick": 0, "piece": "kick", "velocity": 100, "hand": None}],
    }


def _upload_song(client: TestClient, drumscore: dict | None = None) -> int:
    score = drumscore if drumscore is not None else _valid_drumscore()
    files = {"file": ("song.mid", io.BytesIO(b"midi-bytes"), "application/octet-stream")}
    data = {"title": "원본 제목", "drumscore": json.dumps(score)}
    resp = client.post("/songs", data=data, files=files)
    assert resp.status_code == 201
    return resp.json()["id"]


def test_save_requires_login(client: TestClient) -> None:
    resp = client.put("/songs/1/drumscore", content=json.dumps(_valid_drumscore()))
    assert resp.status_code == 401


def test_save_then_reload_matches(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload_song(client)

    edited = _valid_drumscore(bpm=140)
    edited["notes"].append({"tick": 480, "piece": "snare", "velocity": 90, "hand": None})
    resp = client.put(f"/songs/{song_id}/drumscore", content=json.dumps(edited))
    assert resp.status_code == 204

    reloaded = client.get(f"/songs/{song_id}/drumscore")
    assert reloaded.status_code == 200
    assert reloaded.json() == edited


def test_save_twice_keeps_single_edited_asset(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload_song(client)

    client.put(f"/songs/{song_id}/drumscore", content=json.dumps(_valid_drumscore(bpm=100)))
    client.put(f"/songs/{song_id}/drumscore", content=json.dumps(_valid_drumscore(bpm=200)))

    edited_assets = (
        db_session.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.DRUMSCORE_EDITED)
        .all()
    )
    assert len(edited_assets) == 1

    reloaded = client.get(f"/songs/{song_id}/drumscore")
    assert reloaded.json()["meta"]["bpm"] == 200


def _make_song(db_session, user: User) -> int:
    from db.models import Song, SongSourceType, SongStatus

    song = Song(
        user_id=user.id, title="곡", source_type=SongSourceType.MIDI, status=SongStatus.COMPLETED
    )
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    return song.id


def test_partial_unique_index_rejects_duplicate_edited_asset(db_session) -> None:
    # Codex 모드C C-001: DB가 직접 중복을 막는지 — ORM으로 같은 song_id에
    # drumscore_edited를 두 번 저장 시도하면 두 번째가 거부돼야 한다.
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    db_session.add(Asset(song_id=song_id, kind=AssetKind.DRUMSCORE_EDITED, file_path="x/a.json"))
    db_session.commit()
    db_session.add(Asset(song_id=song_id, kind=AssetKind.DRUMSCORE_EDITED, file_path="x/b.json"))
    with pytest.raises(Exception, match="(?i)unique|integrity"):
        db_session.commit()


def test_partial_unique_index_does_not_affect_other_kinds(db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    db_session.add(Asset(song_id=song_id, kind=AssetKind.ORIGINAL, file_path="x/original.mid"))
    db_session.add(Asset(song_id=song_id, kind=AssetKind.ORIGINAL, file_path="x/original2.mid"))
    db_session.commit()  # 둘 다 kind='original'이라 거부되지 않아야 함
    rows = (
        db_session.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.ORIGINAL)
        .all()
    )
    assert len(rows) == 2


def test_save_recovers_from_concurrent_insert_race(
    client: TestClient, db_session, monkeypatch
) -> None:
    # Codex 모드C C-001(2차): "찾아서 없으면 INSERT" 사이에 다른 요청이 먼저 행을
    # 만든 경쟁 상태를 강제로 재현한다 — _find_edited_asset을 몽키패치해 항상
    # None(없음)을 보고하도록 만들어 놓고(실제로는 이미 있는데도), DB엔 미리
    # DRUMSCORE_EDITED 행을 심어둔다. 엔드포인트가 INSERT를 시도하면 부분 유니크
    # 인덱스가 실제로 IntegrityError를 던지고, rollback() 후 재조회→UPDATE로
    # 복구해 500이 아니라 204로 끝나는지 확인한다.
    import api.songs as songs_module
    from db.models import Asset, AssetKind

    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload_song(client)

    db_session.add(
        Asset(song_id=song_id, kind=AssetKind.DRUMSCORE_EDITED, file_path=f"{song_id}/stale.json")
    )
    db_session.commit()

    # 첫 호출(저장 로직의 최초 조회)만 "없음"으로 속이고, IntegrityError 이후의
    # 재조회(실제 복구 로직)는 진짜 함수가 동작해 방금 심어둔 행을 찾게 한다 —
    # 그래야 재조회까지 속이는 게 아니라 "최초 조회 시점의 경쟁 상태"만 재현.
    real_find = songs_module._find_edited_asset
    call_count = {"n": 0}

    def fake_find(db, sid):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return None
        return real_find(db, sid)

    monkeypatch.setattr(songs_module, "_find_edited_asset", fake_find)

    new_score = _valid_drumscore(bpm=175)
    resp = client.put(f"/songs/{song_id}/drumscore", content=json.dumps(new_score))
    assert resp.status_code == 204

    edited_assets = (
        db_session.query(Asset)
        .filter(Asset.song_id == song_id, Asset.kind == AssetKind.DRUMSCORE_EDITED)
        .all()
    )
    assert len(edited_assets) == 1
    assert edited_assets[0].file_path == f"{song_id}/drumscore_edited.json"


def test_other_user_cannot_save_drumscore(client: TestClient, db_session) -> None:
    _make_user(db_session, "owner")
    _make_user(db_session, "other")
    _login(client, "owner")
    song_id = _upload_song(client)

    _login(client, "other")
    resp = client.put(f"/songs/{song_id}/drumscore", content=json.dumps(_valid_drumscore()))
    assert resp.status_code == 404


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["meta"].update(bpm=0),
        lambda d: d["notes"][0].update(velocity=200),
        lambda d: d["notes"][0].update(piece="not_a_real_piece"),
    ],
)
def test_save_rejects_invalid_drumscore_invariants(client: TestClient, db_session, mutate) -> None:
    # T2-5의 DrumScoreIn을 그대로 재사용한다는 것만 확인(전체 재검증은 T2-5 쪽에서 이미 함).
    _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload_song(client)

    score = _valid_drumscore()
    mutate(score)
    resp = client.put(f"/songs/{song_id}/drumscore", content=json.dumps(score))
    assert resp.status_code == 422


def test_write_song_file_atomic_replace_leaves_no_tmp_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")
    path1 = file_storage.write_song_file(1, "drumscore_edited.json", b'{"a":1}')
    path2 = file_storage.write_song_file(1, "drumscore_edited.json", b'{"a":2}')
    assert path1 == path2

    song_dir = file_storage.SONGS_ROOT / "1"
    files = list(song_dir.iterdir())
    assert [f.name for f in files] == ["drumscore_edited.json"]  # 임시 파일 안 남음
    assert (song_dir / "drumscore_edited.json").read_bytes() == b'{"a":2}'
