"""T6-11(REQ-04, Q-33) GET /songs/{id}/audio/{kind}/tempo/{permille}.

근거: work/T6-11/plan.md "API 계약". test_songs_audio.py와 같은 소유권·
존재 여부 검사 패턴을 재사용하고, 실제 변환은 test_atempo.py처럼 real
ffmpeg(사인파 WAV)로 확인한다.
"""

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import file_storage
import modules.tempo.atempo as atempo_module
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
    songs_root = tmp_path / "songs"
    monkeypatch.setattr(file_storage, "SONGS_ROOT", songs_root)
    monkeypatch.setattr(atempo_module, "SONGS_ROOT", songs_root)

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


def _write_tone(path: Path, duration_s: float = 0.5, sr: int = 44100) -> None:
    t = np.linspace(0, duration_s, int(sr * duration_s), endpoint=False)
    y = 0.3 * np.sin(2 * np.pi * 440 * t)
    sf.write(str(path), y.astype(np.float32), sr)


def _make_song_with_stem_drums(db_session, user) -> Song:
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    wav_path = file_storage.song_storage_dir(song.id) / "stem_drums.wav"
    _write_tone(wav_path)
    db_session.add(
        Asset(song_id=song.id, kind=AssetKind.STEM_DRUMS, file_path=f"{song.id}/stem_drums.wav")
    )
    db_session.commit()
    return song


def test_tempo_requires_login(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)

    resp = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1200")

    assert resp.status_code == 401


def test_tempo_converts_and_sets_header(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1200")

    assert resp.status_code == 200
    assert resp.headers["x-tempo-permille"] == "1200"
    assert resp.headers["content-type"] == "audio/mpeg"
    assert len(resp.content) > 0


def test_tempo_1000_returns_original_without_conversion(
    client: TestClient, db_session, monkeypatch
) -> None:
    """1000(배속 변경 없음)은 atempo조차 안 거치고 원본을 그대로 서빙해야
    한다 — time_stretch_mp3()가 아예 호출되지 않는 것까지 확인."""
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)
    _login(client, "u1")

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("permille=1000은 time_stretch_mp3()를 부르면 안 됨")

    monkeypatch.setattr(atempo_module, "time_stretch_mp3", _fail_if_called)

    resp = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1000")

    assert resp.status_code == 200
    assert resp.headers["x-tempo-permille"] == "1000"
    assert resp.headers["content-type"] == "audio/wav"


def test_tempo_caches_so_second_request_does_not_reconvert(
    client: TestClient, db_session, monkeypatch
) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)
    _login(client, "u1")

    call_count = 0
    real = atempo_module.time_stretch_mp3

    def _counting(path, permille):
        nonlocal call_count
        call_count += 1
        return real(path, permille)

    monkeypatch.setattr(atempo_module, "time_stretch_mp3", _counting)

    first = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1200")
    second = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1200")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.content == second.content
    assert call_count == 1


def test_tempo_rejects_original_kind(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/original/tempo/1200")

    assert resp.status_code == 400


def test_tempo_rejects_out_of_range_permille(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)
    _login(client, "u1")

    too_low = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/100")
    too_high = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/2000")

    assert too_low.status_code == 422
    assert too_high.status_code == 422


def test_tempo_rejects_non_audio_kind(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = _make_song_with_stem_drums(db_session, user)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/drumscore_raw/tempo/1200")

    assert resp.status_code == 422


def test_tempo_404_when_asset_row_missing(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "u1")
    song = Song(user_id=user.id, title="곡", source_type=SongSourceType.AUDIO)
    db_session.add(song)
    db_session.commit()
    db_session.refresh(song)
    _login(client, "u1")

    resp = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1200")

    assert resp.status_code == 404


def test_other_user_cannot_get_tempo_audio(client: TestClient, db_session) -> None:
    owner = _make_user(db_session, "owner")
    _make_user(db_session, "other")
    song = _make_song_with_stem_drums(db_session, owner)

    _login(client, "other")
    resp = client.get(f"/songs/{song.id}/audio/stem_drums/tempo/1200")

    assert resp.status_code == 404
