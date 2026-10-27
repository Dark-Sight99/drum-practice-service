"""T3-28 GET/PUT /auth/me/mixer-setting(계정 전체 공유 믹서 설정). 근거: REQ-05,
2026-10-27 의뢰인 요청("믹서값을 계정 기준으로 공유"). `test_songs_practice_setting_api.py`
와 같은 패턴 — 곡이 아니라 계정(user) 하나에 유니크라는 점만 다름."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
from api.deps import get_db
from api.main import app
from auth.security import hash_password
from db.models import Base, Song, SongSourceType, User, UserMixerSetting
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


def test_get_requires_login(client: TestClient) -> None:
    resp = client.get("/auth/me/mixer-setting")
    assert resp.status_code == 401


def test_get_returns_null_volumes_when_nothing_saved(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    resp = client.get("/auth/me/mixer-setting")

    assert resp.status_code == 200
    assert resp.json() == {"volumes": None}


def test_put_then_get_round_trips(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    volumes = _full_volumes(volume=0.5, muted=True, solo=False)
    resp = client.put("/auth/me/mixer-setting", json={"volumes": volumes})
    assert resp.status_code == 204

    reloaded = client.get("/auth/me/mixer-setting")
    assert reloaded.status_code == 200
    assert reloaded.json() == {"volumes": volumes}


def test_put_twice_updates_in_place_not_duplicated(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    _login(client, "u1")

    client.put("/auth/me/mixer-setting", json={"volumes": _full_volumes(volume=0.2)})
    client.put("/auth/me/mixer-setting", json={"volumes": _full_volumes(volume=0.8)})

    rows = db_session.query(UserMixerSetting).filter(UserMixerSetting.user_id == user.id).all()
    assert len(rows) == 1
    assert json.loads(rows[0].volumes_json)["stem_drums"]["volume"] == 0.8


def test_put_rejects_missing_channel(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    incomplete = _full_volumes()
    del incomplete["metronome"]
    resp = client.put("/auth/me/mixer-setting", json={"volumes": incomplete})

    assert resp.status_code == 422


def test_put_rejects_unknown_channel(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    extra = _full_volumes()
    extra["bogus_channel"] = {"volume": 1.0, "muted": False, "solo": False}
    resp = client.put("/auth/me/mixer-setting", json={"volumes": extra})

    assert resp.status_code == 422


def test_put_rejects_volume_out_of_range(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")

    out_of_range = _full_volumes(volume=1.5)
    resp = client.put("/auth/me/mixer-setting", json={"volumes": out_of_range})

    assert resp.status_code == 422


def test_other_user_does_not_see_this_users_setting(client: TestClient, db_session) -> None:
    """핵심 불변식(T3-28) — 계정 전체로 공유되는 건 "같은 계정의 곡들 사이"
    까지고, 다른 계정과는 당연히 격리돼야 한다."""
    _make_user(db_session, "owner")
    _make_user(db_session, "other")

    _login(client, "owner")
    client.put("/auth/me/mixer-setting", json={"volumes": _full_volumes(volume=0.3)})

    _login(client, "other")
    resp = client.get("/auth/me/mixer-setting")
    assert resp.status_code == 200
    assert resp.json() == {"volumes": None}


def test_setting_is_shared_across_different_songs_of_same_user(
    client: TestClient, db_session
) -> None:
    """2026-10-27 의뢰인 요청 그 자체 — "1번 곡에서 세팅한 믹서값이 2번·3번
    곡으로 가도 유지되도록". 이 엔드포인트는 song_id를 전혀 받지 않으므로,
    같은 계정이면 어느 곡을 열었는지와 무관하게 항상 같은 값을 돌려준다."""
    user = _make_user(db_session, "u1")
    _make_song(db_session, user)  # 곡 A — 이 엔드포인트는 song_id를 안 쓰므로 id 자체는 무관
    _make_song(db_session, user)  # 곡 B
    _login(client, "u1")

    volumes = _full_volumes(volume=0.42)
    client.put("/auth/me/mixer-setting", json={"volumes": volumes})

    # "곡 A에서 연 뒤"와 "곡 B에서 연 뒤" 둘 다 같은 GET을 부르므로(프런트
    # PracticeCanvas.tsx — 곡마다 다시 마운트돼도 song_id 없이 이 엔드포인트만
    # 부름), 두 번 호출해도 항상 같은 값이 와야 한다.
    first = client.get("/auth/me/mixer-setting")
    second = client.get("/auth/me/mixer-setting")
    assert first.json() == {"volumes": volumes}
    assert second.json() == {"volumes": volumes}


def test_save_recovers_from_concurrent_first_insert_race(
    client: TestClient, db_session, monkeypatch
) -> None:
    """모드C 1라운드 C-005 / T3-4의 같은 재현 방식을 계정 전체 설정에도
    재사용 — _find_user_mixer_setting의 첫 호출만 "없음"으로 속여 INSERT
    경로를 타게 만들고(실제로는 이미 행이 있음), IntegrityError 복구 경로가
    500이 아니라 204로 끝나며 행이 1개로 수렴하는지 확인한다."""
    import api.auth as auth_module

    user = _make_user(db_session, "u1")
    db_session.add(
        UserMixerSetting(user_id=user.id, volumes_json=json.dumps(_full_volumes(volume=0.1)))
    )
    db_session.commit()
    _login(client, "u1")

    real_find = auth_module._find_user_mixer_setting
    call_count = {"n": 0}

    def fake_find(db, uid):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return None
        return real_find(db, uid)

    monkeypatch.setattr(auth_module, "_find_user_mixer_setting", fake_find)

    resp = client.put("/auth/me/mixer-setting", json={"volumes": _full_volumes(volume=0.9)})
    assert resp.status_code == 204

    rows = db_session.query(UserMixerSetting).filter(UserMixerSetting.user_id == user.id).all()
    assert len(rows) == 1
    assert json.loads(rows[0].volumes_json)["stem_drums"]["volume"] == 0.9
