"""T3-4 GET/PUT /songs/{id}/practice-setting(믹서 설정 저장). 근거: REQ-05,
work/T3-4/plan.md §1."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
from api.deps import get_db
from api.main import app
from auth.security import hash_password
from db.models import Base, PracticeSetting, Song, SongSourceType, User
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


def _make_song(db_session, user: User) -> int:
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    return song.id


def _login(client: TestClient, username: str) -> None:
    resp = client.post("/auth/login", json={"username": username, "password": "pw1234"})
    assert resp.status_code == 200


def _full_volumes(volume: float = 1.0, muted: bool = False, solo: bool = False) -> dict:
    channel = {"volume": volume, "muted": muted, "solo": solo}
    return {
        "stem_drums": dict(channel),
        "stem_bass": dict(channel),
        "stem_vocals": dict(channel),
        "stem_other": dict(channel),
        "synth_drums": dict(channel),
        "metronome": dict(channel),
    }


def test_get_requires_login(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    resp = client.get(f"/songs/{song_id}/practice-setting")
    assert resp.status_code == 401


def test_get_returns_null_volumes_when_nothing_saved(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song_id}/practice-setting")

    assert resp.status_code == 200
    assert resp.json() == {"volumes": None}


def test_put_then_get_round_trips(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    _login(client, "u1")

    volumes = _full_volumes(volume=0.5, muted=True, solo=False)
    resp = client.put(f"/songs/{song_id}/practice-setting", json={"volumes": volumes})
    assert resp.status_code == 204

    reloaded = client.get(f"/songs/{song_id}/practice-setting")
    assert reloaded.status_code == 200
    assert reloaded.json() == {"volumes": volumes}


def test_put_twice_updates_in_place_not_duplicated(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    _login(client, "u1")

    client.put(f"/songs/{song_id}/practice-setting", json={"volumes": _full_volumes(volume=0.2)})
    client.put(f"/songs/{song_id}/practice-setting", json={"volumes": _full_volumes(volume=0.8)})

    rows = db_session.query(PracticeSetting).filter(PracticeSetting.song_id == song_id).all()
    assert len(rows) == 1
    assert json.loads(rows[0].volumes_json)["stem_drums"]["volume"] == 0.8


def test_put_rejects_missing_channel(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    _login(client, "u1")

    incomplete = _full_volumes()
    del incomplete["metronome"]
    resp = client.put(f"/songs/{song_id}/practice-setting", json={"volumes": incomplete})

    assert resp.status_code == 422


def test_put_rejects_unknown_channel(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    _login(client, "u1")

    extra = _full_volumes()
    extra["bogus_channel"] = {"volume": 1.0, "muted": False, "solo": False}
    resp = client.put(f"/songs/{song_id}/practice-setting", json={"volumes": extra})

    assert resp.status_code == 422


def test_put_rejects_volume_out_of_range(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    _login(client, "u1")

    out_of_range = _full_volumes(volume=1.5)
    resp = client.put(f"/songs/{song_id}/practice-setting", json={"volumes": out_of_range})

    assert resp.status_code == 422


def test_put_does_not_touch_practice_bpm_or_loop_columns(client: TestClient, db_session) -> None:
    """work/T3-4/plan.md §범위경계 — practice_bpm/루프 컬럼은 이번 작업 범위
    밖이라 기존 값이 있으면 그대로 둬야 한다."""
    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    db_session.add(
        PracticeSetting(
            song_id=song_id, practice_bpm=128.0, loop_start_measure=2, loop_end_measure=6
        )
    )
    db_session.commit()
    _login(client, "u1")

    client.put(f"/songs/{song_id}/practice-setting", json={"volumes": _full_volumes()})

    row = db_session.query(PracticeSetting).filter(PracticeSetting.song_id == song_id).first()
    assert row.practice_bpm == 128.0
    assert row.loop_start_measure == 2
    assert row.loop_end_measure == 6


def test_other_user_cannot_access_practice_setting(client: TestClient, db_session) -> None:
    owner = _make_user(db_session, "owner")
    _make_user(db_session, "other")
    song_id = _make_song(db_session, owner)

    _login(client, "other")
    get_resp = client.get(f"/songs/{song_id}/practice-setting")
    put_resp = client.put(f"/songs/{song_id}/practice-setting", json={"volumes": _full_volumes()})

    assert get_resp.status_code == 404
    assert put_resp.status_code == 404


def test_save_recovers_from_concurrent_first_insert_race(
    client: TestClient, db_session, monkeypatch
) -> None:
    """모드C 1라운드 C-005 회귀 — T2-6의 "낙관적 upsert"와 같은 재현 방식:
    _find_practice_setting의 첫 호출만 "없음"으로 속여 INSERT 경로를 타게
    만들고(실제로는 이미 행이 있음), IntegrityError 복구 경로가 500이 아니라
    204로 끝나며 행이 1개로 수렴하는지 확인한다."""
    import api.songs as songs_module

    user = _make_user(db_session, "u1")
    song_id = _make_song(db_session, user)
    db_session.add(
        PracticeSetting(song_id=song_id, volumes_json=json.dumps(_full_volumes(volume=0.1)))
    )
    db_session.commit()
    _login(client, "u1")

    real_find = songs_module._find_practice_setting
    call_count = {"n": 0}

    def fake_find(db, sid):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return None
        return real_find(db, sid)

    monkeypatch.setattr(songs_module, "_find_practice_setting", fake_find)

    resp = client.put(
        f"/songs/{song_id}/practice-setting", json={"volumes": _full_volumes(volume=0.9)}
    )
    assert resp.status_code == 204

    rows = db_session.query(PracticeSetting).filter(PracticeSetting.song_id == song_id).all()
    assert len(rows) == 1
    assert json.loads(rows[0].volumes_json)["stem_drums"]["volume"] == 0.9
