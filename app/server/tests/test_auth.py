"""T1-3 로그인/세션/비로그인 차단/사용자간 격리 테스트. 근거: REQ-08, work/T1-3/plan.md."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.deps import SESSION_COOKIE_NAME, get_db
from api.main import app
from auth.security import hash_password, hash_session_token, utcnow_naive
from db.models import Base, Song, SongSourceType, User, UserSession
from db.session import create_sqlite_engine


@pytest.fixture
def db_session():
    # FastAPI TestClient는 엔드포인트를 별도 워커 스레드에서 실행하므로(실제 실행으로 확인된
    # "SQLite objects created in a thread can only be used in..." 오류), 메모리 DB를 여러
    # 스레드가 공유하려면 StaticPool(연결 하나만 계속 재사용) + check_same_thread=False가 필요하다.
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
    # base_url을 https로 줘야 한다 — 로그인 쿠키가 secure=True라(프로덕션은 Tailscale HTTPS
    # 전제), 기본값인 http://testserver로 테스트하면 쿠키가 아예 저장/전송되지 않아
    # 로그인 이후 모든 요청이 401로 실패한다(실제로 재현됨).
    with TestClient(app, base_url="https://testserver") as c:
        yield c
    app.dependency_overrides.clear()


def _make_user(
    db_session, username="jaewoo", password="pw1234", is_admin=False, is_active=True
) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password),
        is_admin=is_admin,
        is_active=is_active,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_login_success_sets_httponly_cookie(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234")
    resp = client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "jaewoo"

    set_cookie = resp.headers["set-cookie"]
    assert "drum_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Secure" in set_cookie
    assert "samesite=lax" in set_cookie.lower()


def test_login_wrong_password_rejected(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234")
    resp = client.post("/auth/login", json={"username": "jaewoo", "password": "wrong"})
    assert resp.status_code == 401


def test_login_inactive_account_rejected(client: TestClient, db_session) -> None:
    _make_user(db_session, "suspended", "pw1234", is_active=False)
    resp = client.post("/auth/login", json={"username": "suspended", "password": "pw1234"})
    assert resp.status_code == 401


def test_protected_endpoint_requires_login(client: TestClient) -> None:
    resp = client.get("/songs")
    assert resp.status_code == 401
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_cross_user_cannot_see_others_songs(client: TestClient, db_session) -> None:
    _make_user(db_session, "user1", "pw1")
    u2 = _make_user(db_session, "user2", "pw2")
    db_session.add(Song(user_id=u2.id, title="user2의 비밀곡", source_type=SongSourceType.AUDIO))
    db_session.commit()
    song2 = db_session.query(Song).filter(Song.user_id == u2.id).first()

    client.post("/auth/login", json={"username": "user1", "password": "pw1"})

    # 목록에 안 보임
    resp = client.get("/songs")
    assert resp.status_code == 200
    assert resp.json() == []

    # 상세도 못 봄 — 403이 아니라 404(존재 자체를 흘리지 않음, REQ-08)
    resp = client.get(f"/songs/{song2.id}")
    assert resp.status_code == 404


def test_logout_invalidates_session(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234")
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})
    assert client.get("/auth/me").status_code == 200

    resp = client.post("/auth/logout")
    assert resp.status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_suspend_existing_session_blocks_immediately(client: TestClient, db_session) -> None:
    """REQ-08 핵심: 로그인된 상태에서 관리자가 계정을 정지하면,
    기존 쿠키로도 다음 요청부터 바로 막혀야 한다."""
    user = _make_user(db_session, "jaewoo", "pw1234")
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})
    assert client.get("/auth/me").status_code == 200

    # 관리자 액션을 흉내: DB에서 직접 정지(관리자 API 자체는 아래 admin 테스트에서 별도 확인)
    user.is_active = False
    db_session.commit()

    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_expired_session_rejected(client: TestClient, db_session) -> None:
    user = _make_user(db_session, "jaewoo", "pw1234")
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})

    session_row = db_session.query(UserSession).filter(UserSession.user_id == user.id).first()
    session_row.expires_at = utcnow_naive() - timedelta(days=1)
    db_session.commit()

    assert client.get("/auth/me").status_code == 401


def test_admin_can_create_and_suspend_user(client: TestClient, db_session) -> None:
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.post("/admin/users", json={"username": "newbie", "password": "newbiepw"})
    assert resp.status_code == 201
    new_id = resp.json()["id"]

    resp = client.patch(f"/admin/users/{new_id}", json={"is_active": False})
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


def test_non_admin_cannot_access_admin_endpoints(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234", is_admin=False)
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})

    resp = client.post("/admin/users", json={"username": "x", "password": "y"})
    assert resp.status_code == 403


def test_admin_can_list_users(client: TestClient, db_session) -> None:
    """2026-10-29(의뢰인 요청) — 계정 관리 화면의 "아이디 찾기" 겸 목록."""
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    _make_user(db_session, "someone", "pw1234")
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.get("/admin/users")
    assert resp.status_code == 200
    usernames = {u["username"] for u in resp.json()}
    assert usernames == {"admin", "someone"}


def test_non_admin_cannot_list_users(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234", is_admin=False)
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})

    resp = client.get("/admin/users")
    assert resp.status_code == 403


def test_admin_can_reset_password(client: TestClient, db_session) -> None:
    """2026-10-29(의뢰인 요청) — "비번 찾기": 이메일 없이 관리자가 직접 재설정."""
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    target = _make_user(db_session, "forgetful", "oldpw")
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.post(f"/admin/users/{target.id}/reset-password", json={"new_password": "newpw"})
    assert resp.status_code == 204

    # 새 비밀번호로는 로그인되고, 옛 비밀번호로는 안 된다.
    client.cookies.clear()
    assert client.post(
        "/auth/login", json={"username": "forgetful", "password": "newpw"}
    ).status_code == 200
    client.cookies.clear()
    assert client.post(
        "/auth/login", json={"username": "forgetful", "password": "oldpw"}
    ).status_code == 401


def test_reset_password_invalidates_existing_sessions(client: TestClient, db_session) -> None:
    """Codex 모드A 지적(필수) — 비밀번호를 재설정해도 재설정 전부터 로그인돼
    있던 기기의 쿠키가 계속 유효하면 안 된다(REQ-08 "정지 시 즉시 차단"과
    같은 원칙). test_tampered_session_token_rejected와 같은 방식으로 쿠키를
    client 인스턴스에 직접 심는다(요청별 cookies= 인자는 deprecated)."""
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    target = _make_user(db_session, "forgetful", "oldpw")

    # "forgetful"이 먼저 로그인해 세션 쿠키를 들고 있는 상태를 흉내낸다.
    login_resp = client.post("/auth/login", json={"username": "forgetful", "password": "oldpw"})
    victim_token = login_resp.cookies[SESSION_COOKIE_NAME]
    assert client.get("/auth/me").status_code == 200

    # 관리자가 비밀번호를 재설정.
    client.cookies.clear()
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})
    resp = client.post(f"/admin/users/{target.id}/reset-password", json={"new_password": "newpw"})
    assert resp.status_code == 204

    # 재설정 전 쿠키는 더 이상 통하지 않아야 한다.
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, victim_token)
    assert client.get("/auth/me").status_code == 401


def test_admin_can_update_username_and_admin_flag(client: TestClient, db_session) -> None:
    """2026-10-29(의뢰인 요청) — "아이디비밀번호 변경", "관리자권한이나,
    관리자권한제거나"를 이 화면에서."""
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    target = _make_user(db_session, "someone", "pw1234", is_admin=False)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.patch(
        f"/admin/users/{target.id}", json={"username": "renamed", "is_admin": True}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "renamed"
    assert body["is_admin"] is True

    # 다시 로그인하면(세션은 안 끊김, 하지만 확인차) 바뀐 아이디로 들어간다.
    client.cookies.clear()
    assert client.post(
        "/auth/login", json={"username": "renamed", "password": "pw1234"}
    ).status_code == 200


def test_update_user_username_conflict_returns_409(client: TestClient, db_session) -> None:
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    _make_user(db_session, "taken", "pw1")
    target = _make_user(db_session, "someone", "pw2")
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.patch(f"/admin/users/{target.id}", json={"username": "taken"})
    assert resp.status_code == 409


def test_admin_cannot_remove_own_admin_flag(client: TestClient, db_session) -> None:
    """Q-16(intent/07-open-questions.md, "의뢰인 혼자 관리자인 전제") — 본인이
    본인 관리자 권한을 해제하면 아무도 관리자가 없는 화면에 갇힐 수 있다."""
    admin = _make_user(db_session, "admin", "adminpw", is_admin=True)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.patch(f"/admin/users/{admin.id}", json={"is_admin": False})
    assert resp.status_code == 400

    db_session.refresh(admin)
    assert admin.is_admin is True


def test_admin_cannot_suspend_self_via_api(client: TestClient, db_session) -> None:
    """AdminScreen.tsx가 버튼을 막아도, API를 직접 호출하는 우회까지
    서버에서 막아야 한다(서버가 최종 권위)."""
    admin = _make_user(db_session, "admin", "adminpw", is_admin=True)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.patch(f"/admin/users/{admin.id}", json={"is_active": False})
    assert resp.status_code == 400

    db_session.refresh(admin)
    assert admin.is_active is True


def test_admin_can_delete_user_and_their_songs(client: TestClient, db_session) -> None:
    """2026-10-29(의뢰인 요청) — "삭제... 기능들을 이 페이지에서"."""
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    target = _make_user(db_session, "doomed", "pw1234")
    db_session.add(
        Song(user_id=target.id, title="지워질 곡", source_type=SongSourceType.AUDIO)
    )
    db_session.commit()
    song = db_session.query(Song).filter(Song.user_id == target.id).first()
    assert song is not None

    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})
    resp = client.delete(f"/admin/users/{target.id}")
    assert resp.status_code == 204

    assert db_session.get(User, target.id) is None
    assert db_session.query(Song).filter(Song.user_id == target.id).first() is None

    # 삭제된 계정으로는 더 이상 로그인되지 않는다.
    client.cookies.clear()
    assert client.post(
        "/auth/login", json={"username": "doomed", "password": "pw1234"}
    ).status_code == 401


def test_admin_cannot_delete_self(client: TestClient, db_session) -> None:
    admin = _make_user(db_session, "admin", "adminpw", is_admin=True)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.delete(f"/admin/users/{admin.id}")
    assert resp.status_code == 400
    assert db_session.get(User, admin.id) is not None


def test_non_admin_cannot_delete_user(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234", is_admin=False)
    target = _make_user(db_session, "someone", "pw1234")
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})

    resp = client.delete(f"/admin/users/{target.id}")
    assert resp.status_code == 403


def test_delete_unknown_user_returns_404(client: TestClient, db_session) -> None:
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.delete("/admin/users/999999")
    assert resp.status_code == 404


def test_non_admin_cannot_reset_password(client: TestClient, db_session) -> None:
    _make_user(db_session, "jaewoo", "pw1234", is_admin=False)
    target = _make_user(db_session, "someone", "pw1234")
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})

    resp = client.post(
        f"/admin/users/{target.id}/reset-password", json={"new_password": "x"}
    )
    assert resp.status_code == 403


def test_reset_password_unknown_user_returns_404(client: TestClient, db_session) -> None:
    _make_user(db_session, "admin", "adminpw", is_admin=True)
    client.post("/auth/login", json={"username": "admin", "password": "adminpw"})

    resp = client.post("/admin/users/999999/reset-password", json={"new_password": "x"})
    assert resp.status_code == 404


def test_login_failures_return_identical_response(client: TestClient, db_session) -> None:
    """Codex 모드A C-001: 존재하지 않는 아이디 / 틀린 비밀번호 / 정지된 계정, 셋 다 상태코드와
    본문이 완전히 같아야 한다(계정 존재·상태를 응답으로 알 수 없게)."""
    _make_user(db_session, "realuser", "correctpw", is_active=True)
    _make_user(db_session, "suspended", "correctpw", is_active=False)

    resp_no_user = client.post("/auth/login", json={"username": "ghost", "password": "whatever"})
    resp_wrong_pw = client.post("/auth/login", json={"username": "realuser", "password": "wrong"})
    resp_suspended = client.post(
        "/auth/login", json={"username": "suspended", "password": "correctpw"}
    )

    statuses = {resp_no_user.status_code, resp_wrong_pw.status_code, resp_suspended.status_code}
    assert statuses == {401}
    assert resp_no_user.json() == resp_wrong_pw.json() == resp_suspended.json()


def test_tampered_session_token_rejected(client: TestClient, db_session) -> None:
    """쿠키 값을 변조해도(세션 테이블에 없는 토큰) 인증되면 안 된다."""
    _make_user(db_session, "jaewoo", "pw1234")
    client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})

    # httpx 쿠키 jar는 domain이 다르면 같은 이름이라도 별도 쿠키로 추가될 뿐 기존 걸 안 바꾼다
    # (실제로 .set()만 호출하니 원래 유효한 쿠키가 그대로 남아 요청이 200으로 통과해버림 —
    # 재현 확인). 먼저 비우고 변조된 토큰만 넣는다.
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE_NAME, "tampered-token-that-does-not-exist")
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_session_token_stored_only_as_hash(client: TestClient, db_session) -> None:
    """쿠키로 내려준 원문 토큰이 DB에 그대로 저장되면 안 되고, 해시만 저장돼야 한다."""
    _make_user(db_session, "jaewoo", "pw1234")
    resp = client.post("/auth/login", json={"username": "jaewoo", "password": "pw1234"})
    raw_token = resp.cookies[SESSION_COOKIE_NAME]

    session_row = db_session.query(UserSession).first()
    assert session_row.token_hash != raw_token
    assert session_row.token_hash == hash_session_token(raw_token)
