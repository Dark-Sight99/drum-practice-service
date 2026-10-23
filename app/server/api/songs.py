"""곡 목록/상세(읽기 전용, 로그인한 사용자 자신의 곡만).

근거: REQ-08 수용 기준("사용자 A가 사용자 B의 곡 라이브러리에 접근 불가")을 실제로 테스트하기 위한
최소 보호 엔드포인트. 업로드·편집 등은 Phase 2 범위(REQ-07).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from db.models import Song, User

router = APIRouter(prefix="/songs", tags=["songs"])


class SongOut(BaseModel):
    id: int
    title: str
    artist: str | None
    status: str

    model_config = {"from_attributes": True}


@router.get("", response_model=list[SongOut])
def list_songs(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Song]:
    return db.query(Song).filter(Song.user_id == user.id).all()


@router.get("/{song_id}", response_model=SongOut)
def get_song(
    song_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Song:
    # 다른 사용자의 곡 id를 넣어도 "권한 없음(403)"이 아니라 "없음(404)"으로 응답한다 —
    # 다른 사용자가 가진 곡 id의 존재 자체를 흘리지 않기 위해(REQ-08 사용자간 완전 분리 취지).
    song = db.query(Song).filter(Song.id == song_id, Song.user_id == user.id).first()
    if song is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "곡을 찾을 수 없습니다")
    return song
