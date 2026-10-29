"""관리자 전용: 계정 생성·정지. 근거: REQ-08("가입 화면 없음, 관리자가 계정을 직접 생성·정지")."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.deps import get_db, require_admin
from auth.security import hash_password
from db.models import Job, JobStatus, Song, User, UserMixerSetting, UserSession
from file_storage import delete_song_files

router = APIRouter(prefix="/admin/users", tags=["admin"])


class CreateUserRequest(BaseModel):
    username: str
    password: str
    is_admin: bool = False


# 2026-10-29(의뢰인 요청) — "계정 권한 설정도 할 수 있게, 삭제나 관리자권한·
# 관리자권한제거나 아이디변경 같은 기능들을 이 페이지에서" — 전부 선택값으로
# 바꿔 하나의 PATCH로 아이디·관리자여부·정지여부 중 보낸 것만 바꾼다(기존
# `{"is_active": false}`만 보내던 호출도 그대로 동작 — 선택값+None 기본이라
# 하위 호환).
class UpdateUserRequest(BaseModel):
    username: str | None = None
    is_admin: bool | None = None
    is_active: bool | None = None


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
    admin: User = Depends(require_admin),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자를 찾을 수 없습니다")
    # 2026-10-29 — Q-16(intent/07-open-questions.md, "의뢰인 혼자 관리자인
    # 전제")·위 AdminScreen 자기 자신 정지 금지와 같은 원칙 — 본인의 관리자
    # 권한을 본인이 해제하면 그 순간 관리자가 아무도 없는 화면으로 잠길 수
    # 있다. 프런트(AdminScreen.tsx)도 버튼을 막지만, API 레벨에서도 막아야
    # 직접 호출을 통한 우회를 막는다(REQ-08 "정지 시 즉시 차단"과 같이
    # 서버가 최종 권위).
    if user_id == admin.id and body.is_admin is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "본인의 관리자 권한은 해제할 수 없습니다")
    if user_id == admin.id and body.is_active is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "본인 계정은 여기서 정지할 수 없습니다")
    if body.username is not None:
        user.username = body.username
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.is_active is not None:
        user.is_active = body.is_active
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 있는 아이디입니다") from exc
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> None:
    # 2026-10-29(의뢰인 요청) — "삭제... 기능들을 이 페이지에서". 본인 계정
    # 삭제는 위 관리자 권한 해제보다 더 되돌리기 어려워(계정 자체가 없어짐)
    # 같은 이유로 막는다.
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "본인 계정은 삭제할 수 없습니다")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "사용자를 찾을 수 없습니다")

    songs = db.query(Song).filter(Song.user_id == user_id).all()
    # delete_song(songs.py)과 같은 보호장치 — 처리 중인 곡이 있으면 통째로
    # 중단(부분 삭제로 어중간한 상태를 남기지 않음).
    has_processing_job = (
        db.query(Job)
        .filter(Job.song_id.in_([s.id for s in songs]), Job.status == JobStatus.PROCESSING)
        .first()
        is not None
    )
    if has_processing_job:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "처리 중인 곡이 있어 삭제할 수 없습니다 — 처리가 끝난 뒤 다시 시도해주세요",
        )

    song_ids = [s.id for s in songs]
    for song in songs:
        db.delete(song)
    db.query(UserMixerSetting).filter(UserMixerSetting.user_id == user_id).delete()
    db.delete(user)  # UserSession은 User.sessions의 cascade="all, delete-orphan"으로 함께 삭제됨
    db.commit()
    for song_id in song_ids:
        delete_song_files(song_id)


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
