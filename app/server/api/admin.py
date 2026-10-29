"""관리자 전용: 계정 생성·정지. 근거: REQ-08("가입 화면 없음, 관리자가 계정을 직접 생성·정지")."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.deps import get_db, require_admin
from auth.security import hash_password
from db.models import User, UserSession

router = APIRouter(prefix="/admin/users", tags=["admin"])


class CreateUserRequest(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class UpdateUserRequest(BaseModel):
    is_active: bool


class ResetPasswordRequest(BaseModel):
    new_password: str


class UserOut(BaseModel):
    id: int
    username: str
    is_admin: bool
    is_active: bool

    model_config = {"from_attributes": True}


# 2026-10-29(의뢰인 요청) — "계정 생성 기능도 있었으면" + "비번 찾기" — REQ-08
# 결정("가입 화면 없음, 관리자가 직접 생성·정지")은 그대로 두고, 그 "관리자가
# 직접"을 할 수 있는 화면이 없었을 뿐이라 화면만 추가. 비번 찾기는 이메일
# 발송 없이 "관리자가 재설정해준다"로(의뢰인 확인) — 목록이 있어야 관리자가
# 어떤 계정이 있는지(=아이디 찾기도 겸함) 보고 고를 수 있다.
@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> list[User]:
    return db.query(User).order_by(User.username).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: CreateUserRequest,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> User:
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        is_admin=body.is_admin,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 있는 아이디입니다") from exc
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UpdateUserRequest,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자를 찾을 수 없습니다")
    user.is_active = body.is_active
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int,
    body: ResetPasswordRequest,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자를 찾을 수 없습니다")
    user.password_hash = hash_password(body.new_password)
    # Codex 모드A 지적(필수, 반영) — 비밀번호만 바꾸고 기존 세션을 그대로 두면,
    # 재설정 전부터 로그인돼 있던 기기는 쿠키가 여전히 유효해 계속 접근할 수
    # 있었다(get_current_user는 UserSession 행 존재만 확인, 비밀번호는
    # 로그인 시점에만 봄). 재설정 시 그 계정의 모든 세션을 지워 다음 요청부터
    # 전부 다시 로그인해야 하게 한다 — REQ-08의 "정지 시 즉시 차단"과 같은
    # 원칙(deps.py get_current_user 코멘트 참고).
    db.query(UserSession).filter(UserSession.user_id == user_id).delete()
    db.commit()
