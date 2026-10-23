"""로그인/로그아웃/현재 사용자. 근거: REQ-08, work/T1-3/plan.md."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import SESSION_COOKIE_NAME, get_current_user, get_db
from auth.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    utcnow_naive,
    verify_password,
)
from db.models import User, UserSession

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_LIFETIME_DAYS = 30  # work/T1-3/plan.md 가정 참고 — 구현 세부사항, 쉽게 바꿀 수 있는 상수

# Codex 모드A C-001: 존재하지 않는 사용자는 verify_password()를 아예 안 거치면(아래처럼
# `user is None or ...`로 단락 평가) argon2 연산 시간만큼 응답이 더 빨라서, 응답 시간 차이로
# "이 아이디가 있는지"를 추측할 수 있었다(실제 재현 확인). 사용자가 없을 때도 항상 이 더미
# 해시로 verify_password()를 호출해 소요 시간을 존재하는 계정과 맞춘다.
_DUMMY_PASSWORD_HASH = hash_password("dummy-password-for-constant-time-login")


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool

    model_config = {"from_attributes": True}


@router.post("/login", response_model=UserOut)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)) -> User:
    user = db.query(User).filter(User.username == body.username).first()
    # Codex 모드A C-001: "사용자 없음" / "비밀번호 틀림" / "계정 정지"를 응답 메시지로도,
    # 처리 시간으로도 구분하지 않는다 — 셋 다 계정 존재 여부·상태를 외부에 알려줄 수 있다.
    # 사용자가 없어도 항상 더미 해시로 verify_password를 호출해 시간차를 없앤다.
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    password_ok = verify_password(password_hash, body.password)
    if user is None or not password_ok or not user.is_active:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "아이디 또는 비밀번호가 올바르지 않습니다"
        )

    token = generate_session_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        expires_at=utcnow_naive() + timedelta(days=SESSION_LIFETIME_DAYS),
    )
    db.add(session)
    user.last_login_at = utcnow_naive()
    db.commit()

    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_LIFETIME_DAYS * 24 * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    # 이 기기(쿠키)의 세션만 지운다 — 다른 기기에 로그인된 세션은 그대로 둔다.
    token = request.cookies[SESSION_COOKIE_NAME]
    db.query(UserSession).filter(UserSession.token_hash == hash_session_token(token)).delete()
    db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user
