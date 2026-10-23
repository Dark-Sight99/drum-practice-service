"""작업 상태 조회(읽기 전용, 로그인한 사용자 자신의 작업만).

근거: REQ-10 수용 기준("사용자 A가 사용자 B의 작업 상태 조회 시도 시 차단(테스트로 증명)").
작업을 큐에 "넣는" API는 이번 범위 밖(업로드 플로우가 생기는 Phase 3에서 추가).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from db.models import Job, User

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobOut(BaseModel):
    id: int
    song_id: int
    job_type: str
    status: str
    error_message: str | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[JobOut])
def list_jobs(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[Job]:
    return db.query(Job).filter(Job.user_id == user.id).all()


@router.get("/{job_id}", response_model=JobOut)
def get_job(
    job_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> Job:
    # songs.py와 같은 이유로 403이 아니라 404 — 다른 사용자의 작업 id 존재 자체를 안 흘림.
    job = db.query(Job).filter(Job.id == job_id, Job.user_id == user.id).first()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "작업을 찾을 수 없습니다")
    return job
