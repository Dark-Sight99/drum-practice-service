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
from db.models import Base, Job, JobStatus, JobType, User
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


def test_upload_oversized_file_stops_reading_early(
    client: TestClient, db_session, monkeypatch
) -> None:
    # Codex 모드B 권장 C-002: 413만 확인하면 "끝까지 다 읽고 나서 거부"와 "상한
    # 넘는 순간 멈춤" 둘 다 통과해버려 조기 중단 자체는 증명 못 한다(작은 파일은
    # 청크 1개 안에 다 들어가서 구분이 안 됨). 10MB 파일 + 2MB 상한으로, 실제
    # UploadFile.read() 호출 횟수를 세어 "끝까지 다(10회) 안 읽고 일찍(상한을
    # 막 넘는 시점인 3회 이하) 멈췄는지"를 직접 검증한다.
    from starlette.datastructures import UploadFile

    import api.songs as songs_module

    _make_user(db_session, "u1")
    _login(client, "u1")
    monkeypatch.setattr(songs_module, "MAX_UPLOAD_BYTES", 2 * 1024 * 1024)

    read_calls = 0
    original_read = UploadFile.read

    async def counting_read(self, size: int = -1) -> bytes:
        nonlocal read_calls
        read_calls += 1
        return await original_read(self, size)

    monkeypatch.setattr(UploadFile, "read", counting_read)

    ten_mb = b"x" * (10 * 1024 * 1024)
    resp = _upload(client, file_bytes=ten_mb)
    assert resp.status_code == 413
    # 끝까지 읽었다면 1MB 청크로 10회(+EOF 확인용 1회)는 필요했을 것 — 2MB
    # 상한을 넘기려면 3번째 청크(2MB 초과 시점)에서 멈춰야 하므로 훨씬 적다.
    assert read_calls <= 4, f"읽기가 일찍 멈추지 않음(read() {read_calls}회 호출)"


def test_upload_rejects_malformed_drumscore_json(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    resp = _upload(client, drumscore="{not valid json")
    assert resp.status_code == 422


def test_upload_rejects_nan_audio_offset(client: TestClient, db_session) -> None:
    # Codex 모드A C-001(재현됨): `value in (inf, -inf)`는 NaN을 못 거름 — 이 테스트가
    # 실제로 그 경로를 통과하는지 확인한다. Python의 json.dumps(allow_nan=True, 기본값)로
    # 만든 리터럴 NaN 토큰을 pydantic-core가 실제로 파싱한다는 것도 이 테스트가 증명한다.
    _make_user(db_session, "u1")
    _login(client, "u1")
    score = _valid_drumscore()
    score["audioOffsetMs"] = float("nan")
    raw = json.dumps(score, allow_nan=True)
    resp = _upload(client, drumscore=raw)
    assert resp.status_code == 422
    assert client.get("/songs").json() == []


def test_upload_rejects_audio_offset_at_or_past_one_beat(client: TestClient, db_session) -> None:
    # T3-72(REQ-02, 다운비트 자동 보정, Q-43) — 예전엔 "0이어야 함"(T2-8, Q-23,
    # Phase 3 오디오-MIDI 정렬 전까지 임시 제한)이었는데, 이제 0 이상·한 박
    # 길이 미만까지 허용한다(work/T3-72/plan.md §6). bpm=120(기본값)의 한 박
    # 길이는 정확히 500ms이므로, 500.0은 "한 박 길이 미만"을 어겨(경계값
    # 자체는 불포함) 여전히 거부돼야 한다.
    _make_user(db_session, "u1")
    _login(client, "u1")
    score = _valid_drumscore()
    score["audioOffsetMs"] = 500.0
    resp = _upload(client, drumscore=json.dumps(score))
    assert resp.status_code == 422
    assert client.get("/songs").json() == []


def test_upload_rejects_negative_audio_offset(client: TestClient, db_session) -> None:
    _make_user(db_session, "u1")
    _login(client, "u1")
    score = _valid_drumscore()
    score["audioOffsetMs"] = -1.0
    resp = _upload(client, drumscore=json.dumps(score))
    assert resp.status_code == 422
    assert client.get("/songs").json() == []


def test_upload_accepts_audio_offset_within_one_beat(client: TestClient, db_session) -> None:
    # T3-72 — 0 초과·한 박 길이 미만인 값은 이제 정상 허용돼야 한다(다운비트
    # 자동 보정이 실제로 채워 넣는 값의 범위).
    _make_user(db_session, "u1")
    _login(client, "u1")
    score = _valid_drumscore()
    score["audioOffsetMs"] = 280.0  # bpm=120 한 박(500ms)보다 작음
    resp = _upload(client, drumscore=json.dumps(score))
    assert resp.status_code == 201
    assert client.get("/songs").json()[0]["id"] is not None


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


def test_delete_song_with_job_succeeds(client: TestClient, db_session) -> None:
    """2026-10-27(실사용 중 재현된 버그, 의뢰인 보고 "삭제가 안 된다") —
    Song.jobs 관계에 cascade가 없으면 곡을 삭제할 때 SQLAlchemy가 연결된
    Job 행을 지우는 대신 FK 컬럼(song_id/user_id)을 NULL로 비우려 시도하는데,
    둘 다 nullable=False라 "NOT NULL constraint failed: jobs.user_id"
    IntegrityError로 삭제 자체가 실패했다 — 업로드로 생긴 곡은 거의 전부
    Job(분리/채보) 행을 최소 하나는 가지므로 실사용에서는 거의 모든 곡
    삭제가 이 경로로 실패하고 있었다. 위 test_delete_song_removes_files는
    MIDI 업로드(_upload)만 써서 Job이 안 생겨 이 버그를 못 잡았다 — 이
    테스트는 Job을 직접 만들어 재현한다."""
    user = _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload(client).json()["id"]

    db_session.add(Job(user_id=user.id, song_id=song_id, job_type=JobType.SEPARATE))
    db_session.commit()

    resp = client.delete(f"/songs/{song_id}")
    assert resp.status_code == 204
    assert client.get(f"/songs/{song_id}").status_code == 404
    assert db_session.query(Job).filter(Job.song_id == song_id).count() == 0


def test_delete_song_blocked_while_job_processing(client: TestClient, db_session) -> None:
    """Codex 모드A 지적(필수, 반영) — 위 cascade 수정으로 삭제 자체는 이제
    성공하지만, 워커가 바로 지금 이 곡의 Job을 PROCESSING 중이면 경합이
    생긴다: 워커는 이미 메모리에 들고 있는 Job 객체로 계속 파일을 쓰고
    Asset을 커밋하려 드는데, 그 사이 여기서 DB 행과 파일을 먼저 지워버리면
    핸들러의 커밋이 실패하거나 방금 지운 곡 폴더에 파일을 다시 써 넣어
    디스크에 고아 파일로 영구히 남을 수 있다 — PROCESSING인 Job이 있으면
    삭제 자체를 막아 경합을 원천 차단한다. QUEUED는 아직 아무도 안 집어서
    안전(워커가 집으려 할 때 이미 없는 행이라 그냥 건너뜀)하므로 막지 않음
    — test_delete_song_with_job_succeeds(기본값 QUEUED)가 이미 확인."""
    user = _make_user(db_session, "u1")
    _login(client, "u1")
    song_id = _upload(client).json()["id"]

    db_session.add(
        Job(
            user_id=user.id,
            song_id=song_id,
            job_type=JobType.SEPARATE,
            status=JobStatus.PROCESSING,
        )
    )
    db_session.commit()

    resp = client.delete(f"/songs/{song_id}")
    assert resp.status_code == 409
    # 아무것도 안 지워졌어야 함 — 곡도, 그 Job도.
    assert client.get(f"/songs/{song_id}").status_code == 200
    assert db_session.query(Job).filter(Job.song_id == song_id).count() == 1


def test_resolve_asset_path_blocks_traversal(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(file_storage, "SONGS_ROOT", tmp_path / "songs")
    file_storage.SONGS_ROOT.mkdir(parents=True)
    assert file_storage.resolve_asset_path("../../etc/passwd") is None
    assert file_storage.resolve_asset_path("/etc/passwd") is None
    assert file_storage.resolve_asset_path("1/../../2/drumscore.json") is None
    # 정상 경로는 허용
    assert file_storage.resolve_asset_path("1/drumscore.json") is not None
