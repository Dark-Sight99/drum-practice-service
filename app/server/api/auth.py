"""로그인/로그아웃/현재 사용자. 근거: REQ-08, work/T1-3/plan.md."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import SESSION_COOKIE_NAME, get_current_user, get_db
from auth.security import (
    generate_session_token,
    hash_session_token,
    utcnow_naive,
    verify_password,
)
from db.models import User, UserSession

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_LIFETIME_DAYS = 30  # work/T1-3/plan.md 가정 참고 — 구현 세부사항, 쉽게 바꿀 수 있는 상수


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
    # 사용자 없음과 비밀번호 틀림을 구분해 응답하지 않는다(계정 존재 여부 노출 방지).
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "아이디 또는 비밀번호가 올바르지 않습니다"
        )
    if not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "계정이 정지됐습니다")

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
