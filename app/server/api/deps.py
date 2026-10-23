"""FastAPI 의존성: DB 세션, 현재 사용자, 관리자 전용. 근거: REQ-08, work/T1-3/plan.md."""

from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from auth.security import hash_session_token, utcnow_naive
from db.models import User, UserSession
from db.session import SessionLocal

SESSION_COOKIE_NAME = "drum_session"


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다")

    token_hash = hash_session_token(token)
    session = db.query(UserSession).filter(UserSession.token_hash == token_hash).first()

    # 세션이 없거나(로그아웃/만료로 삭제됨), 기간이 지났거나, 계정이 정지됐으면 전부 즉시 거부한다.
    # "계정 정지 시 즉시 로그인 불가"(REQ-08)는 로그인 시점뿐 아니라 이미 발급된 쿠키로 들어오는
    # 모든 요청에서 매번 is_active를 다시 확인해야 보장된다 — 세션을 캐시해두지 않는 이유.
    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 유효하지 않습니다")
    if session.expires_at < utcnow_naive():
        db.delete(session)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 만료됐습니다")

    user = session.user
    if not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "계정이 정지됐습니다")

    session.last_seen_at = utcnow_naive()
    db.commit()
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "관리자만 접근할 수 있습니다")
    return user
