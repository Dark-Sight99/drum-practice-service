"""작업 큐 워커. 근거: REQ-10, intent/03-architecture-stack.md §3("작업 워커(별도 프로세스)").

실행: `python -m worker.runner` (무한 루프) 또는
`python -m worker.runner --once`(하나만 처리하고 종료, 수동 QA용).
API 서버(uvicorn)와는 별개의 프로세스로 띄운다 — 브라우저를 닫아도 계속 진행되는 이유.
"""

import argparse
import logging
import time

from sqlalchemy.orm import Session

from auth.security import utcnow_naive
from db.models import Job, JobStatus
from db.session import SessionLocal
from worker.handlers import get_handler

logger = logging.getLogger("worker")

POLL_INTERVAL_SECONDS = 2.0


def recover_orphaned_jobs(db: Session) -> int:
    """워커가 작업을 처리하던 중 죽으면(정전, 강제종료 등) 그 작업은 PROCESSING 상태로 영원히
    멈춰 있는다. 재시작 시 그런 작업을 전부 찾아 FAILED로 표시한다(REQ-10 "재개 또는 실패 표시"
    중 실패 표시 쪽 — 범용 재개는 작업 종류별 체크포인트가 필요한데 아직 실제 처리 모듈
    (Phase 3/4)이 없어 구현 불가능하다는 전제, work/T1-4/plan.md 참고).

    반환값: 실패 처리한 작업 수.
    """
    stuck = db.query(Job).filter(Job.status == JobStatus.PROCESSING).all()
    for job in stuck:
        job.status = JobStatus.FAILED
        job.error_message = "서버 재시작으로 처리가 중단됐습니다"
        job.completed_at = utcnow_naive()
    db.commit()
    return len(stuck)


def _run_job(db: Session, job: Job) -> None:
    handler = get_handler(job.job_type)
    job.status = JobStatus.PROCESSING
    job.started_at = utcnow_naive()
    db.commit()

    if handler is None:
        job.status = JobStatus.FAILED
        job.error_message = f"'{job.job_type.value}' 처리 로직이 아직 구현되지 않았습니다"
        job.completed_at = utcnow_naive()
        db.commit()
        return

    try:
        handler(job)
        job.status = JobStatus.COMPLETED
    except Exception as exc:  # noqa: BLE001 — 작업 핸들러가 뭘 던지든 큐가 멈추면 안 된다
        job.status = JobStatus.FAILED
        job.error_message = str(exc)[:2000]
    job.completed_at = utcnow_naive()
    db.commit()


def process_next_job(db: Session) -> Job | None:
    """가장 오래된 QUEUED 작업 하나를 꺼내 처리한다(FIFO: created_at, 동률이면 id 순).
    처리한 Job을 반환하거나, 큐가 비어 있으면 None을 반환한다."""
    job = (
        db.query(Job)
        .filter(Job.status == JobStatus.QUEUED)
        .order_by(Job.created_at.asc(), Job.id.asc())
        .first()
    )
    if job is None:
        return None
    _run_job(db, job)
    return job


def run_forever(poll_interval: float = POLL_INTERVAL_SECONDS) -> None:
    db = SessionLocal()
    try:
        recovered = recover_orphaned_jobs(db)
        if recovered:
            logger.info("재시작 복구: 처리 중이던 작업 %d개를 실패로 표시", recovered)
        while True:
            job = process_next_job(db)
            if job is None:
                time.sleep(poll_interval)
    finally:
        db.close()


def run_once() -> Job | None:
    db = SessionLocal()
    try:
        recover_orphaned_jobs(db)
        return process_next_job(db)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="작업 하나만 처리하고 종료(수동 QA용)")
    args = parser.parse_args()

    if args.once:
        result = run_once()
        print(f"처리한 작업: {result.id if result else '없음(큐가 비어있음)'}")
    else:
        run_forever()
