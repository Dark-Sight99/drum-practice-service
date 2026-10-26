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
from db.models import Job, JobStatus, JobType, Song, SongStatus
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
    # T3-1(REQ-01) 모드C C-001: 워커가 핸들러 실행 도중(예: Demucs 처리 중) 죽으면
    # 핸들러의 except가 전혀 실행되지 못해 Song이 PROCESSING에 영원히 멈출 수 있다.
    # 방금 FAILED로 되돌린 Job들의 Song도 같이 PROCESSING이면 FAILED로 맞춘다.
    # job_type과 무관한 범용 로직 — 앞으로 생길 다른 핸들러도 "선점 직후 Song을
    # PROCESSING으로 맞추는" 같은 패턴을 쓰면 자동으로 이 복구 혜택을 받는다.
    for job in stuck:
        song = db.get(Song, job.song_id)
        if song is not None and song.status == SongStatus.PROCESSING:
            song.status = SongStatus.FAILED
    db.commit()
    return len(stuck)


def _claim_next_job(db: Session) -> Job | None:
    """가장 오래된 QUEUED 작업 하나를 원자적으로 선점(PROCESSING 전환)한다.

    Codex 모드A C-001(재현됨): 조회(SELECT)와 상태 변경(commit)을 분리해서 하면,
    워커 프로세스를 두 개 이상 띄웠을 때 둘 다 같은 작업을 선택해 동시에 처리할 수
    있음(스레드+별도 커넥션으로 실제 재현, qa-evidence/T1-4/result.md 참고).
    `UPDATE ... WHERE status=QUEUED`을 단일 문장으로 실행해, 두 번째 워커의 UPDATE는
    0행을 갱신하도록(SQLite가 쓰기 트랜잭션을 직렬화하므로 둘 다 성공할 수 없음) 막는다.
    """
    candidate_id = (
        db.query(Job.id)
        .filter(Job.status == JobStatus.QUEUED)
        .order_by(Job.created_at.asc(), Job.id.asc())
        .limit(1)
        .scalar()
    )
    if candidate_id is None:
        return None
    _race_window_hook()
    claimed = (
        db.query(Job)
        .filter(Job.id == candidate_id, Job.status == JobStatus.QUEUED)
        .update(
            {"status": JobStatus.PROCESSING, "started_at": utcnow_naive()},
            synchronize_session=False,
        )
    )
    db.commit()
    if claimed == 0:
        return None
    return db.get(Job, candidate_id)


def _race_window_hook() -> None:
    """운영 코드에서는 아무 동작도 하지 않는다. SELECT와 원자적 UPDATE 사이의 좁은
    경쟁 구간을 테스트에서 monkeypatch로 결정적으로 넓혀, 두 워커가 실제로 같은
    후보를 동시에 집으려 드는 상황을 안정적으로 재현하기 위한 테스트 전용 훅
    (Codex 모드B 지적: 실제 스레드 타이밍에만 의존한 회귀 테스트는 비결정적)."""


def _run_job(db: Session, job: Job) -> None:
    # 모드A 지적(C-001): "핸들러 없음" 분기가 _sync_song_status_with_job() 호출
    # 전에 조기 return하면, 이 Job의 Song이 PROCESSING이었을 경우(다른 핸들러가
    # 이미 그렇게 맞춰놓고 죽은 뒤 이 Job이 재시도되는 등) 안전망을 영영 못 받는다.
    # 두 분기 다 끝에서 같은 안전망을 거치도록 공통 경로로 합친다.
    handler = get_handler(job.job_type)
    if handler is None:
        job.status = JobStatus.FAILED
        job.error_message = f"'{job.job_type.value}' 처리 로직이 아직 구현되지 않았습니다"
    else:
        try:
            handler(job)
            job.status = JobStatus.COMPLETED
        except Exception as exc:  # noqa: BLE001 — 핸들러가 뭘 던지든 큐가 멈추면 안 된다
            job.status = JobStatus.FAILED
            job.error_message = str(exc)[:2000]
    job.completed_at = utcnow_naive()
    db.commit()
    _sync_song_status_with_job(db, job)


# T3-19(2026-10-26) — 한 Job이 성공하면 자동으로 이어 큐에 넣는 "다음 작업
# 종류"를 명시적으로 적어둔다(지금은 SEPARATE→TRANSCRIBE 하나뿐,
# modules/separator/handler.py가 실제로 이 관계대로 큐잉함). 아래
# _sync_song_status_with_job()의 안전망이 "이 Job 다음엔 정확히 이 종류의
# 작업이 와야 정상"을 판단할 때 쓴다 — 여기 없는 job_type은 체인이 없다는
# 뜻이라 안전망이 기존 동작(바로 FAILED 판단) 그대로 적용된다.
_CHAIN_NEXT_JOB_TYPE: dict[JobType, JobType] = {
    JobType.SEPARATE: JobType.TRANSCRIBE,
}


def _sync_song_status_with_job(db: Session, job: Job) -> None:
    """T3-1 모드C 3차 BLOCKING 지적 반영 — 핸들러가 자기 작업의 Song.status를
    스스로 맞추는 게 기본 경로지만, 그 커밋 자체가 실패하는 극히 드문 경우(예:
    핸들러의 "Song.FAILED" 커밋 도중 DB 연결이 끊김)를 대비한 공용 안전망.

    Job이 끝난 상태(COMPLETED/FAILED)인데 Song이 아직 PROCESSING이면 FAILED로
    강제 동기화한다 — Job이 COMPLETED여도 Song 쪽에 그 사실이 안 남았다는 건
    핸들러가 "성공"을 끝까지 커밋하지 못했다는 뜻이라, 실제로 쓸 수 있는 산출물이
    있다고 보장할 수 없어 COMPLETED로 낙관하지 않는다.

    정상 흐름에서는 핸들러가 이미 Song.status를 맞춰놨으므로 이 함수는 항상 no-op
    (song.status가 이미 종료 상태라 바로 반환)이다. recover_orphaned_jobs()와
    역할이 겹치지 않음 — 그쪽은 "워커 강제종료로 Job이 PROCESSING에 멈춘" 경우,
    이쪽은 "Job은 정상적으로 끝났는데 핸들러의 Song 커밋만 실패한" 경우를 커버한다.
    job_type과 무관한 범용 로직이라 향후 다른 핸들러도 자동으로 이 보호를 받는다.

    T3-2 모드A 지적(C-003): 핸들러가 맨 처음 "Song.PROCESSING" 커밋 자체에
    실패하면(극히 드문 DB 오류), Song은 PROCESSING에도 못 가보고 이전 상태
    (보통 PENDING)에 그대로 머문다 — `song.status != PROCESSING`만 보면 이
    경우를 놓친다. 그래서 "아직 종료 상태(COMPLETED/FAILED)가 아닌 모든 경우"를
    대상으로 넓혔다 — 정상 흐름에서 Job이 끝나는 시점엔 Song이 이미 PROCESSING
    이어야 하므로(해당 핸들러가 가장 먼저 하는 일), PENDING까지 포함해도 정상
    흐름에서 잘못 발동할 일은 없다.

    T3-19(2026-10-26, Codex 모드A 지적 Medium 반영) — `separate_handler`가
    분리 성공 시 TRANSCRIBE 작업을 자동으로 이어 큐에 넣게 되면서, "핸들러가
    끝났는데 Song이 아직 종료 상태가 아니면 버그"라는 이 함수의 원래 전제가
    더는 항상 참이 아니다 — 체인의 중간 단계(분리는 끝났지만 채보가 아직
    안 끝난 상태)도 의도적으로 비종료 상태일 수 있다. 그래서 강제로 FAILED
    처리하기 전에, 이 곡에 **그 작업이 끝나면 다음에 와야 할 정확한 종류의
    작업**이 대기 중인지(QUEUED/PROCESSING) 먼저 확인한다 — 있으면 체인이
    정상 진행 중이라는 뜻이라 그대로 둔다(다음에 그 작업이 끝날 때 이 함수가
    다시 호출돼 그때 가서 같은 판단을 반복함).

    모드A 재검토 지적(Medium, 반영) — 처음엔 "이 곡에 대한 다른 작업이면
    아무거나" 있어도 넘어갔는데, 그러면 이 곡과 무관하게 남아있는 오래된
    작업(예: 수동 `POST /songs/{id}/transcribe` 재호출이 남긴 작업, 지금
    코드에선 실제로 안 생기지만 미래에 재분리 기능 등이 생기면 생길 수 있음)
    때문에 진짜 실패를 영영 FAILED로 못 바꾸는 경우가 생길 수 있었다 —
    `_CHAIN_NEXT_JOB_TYPE`에 "이 job_type 다음엔 이 job_type이 와야 정상"을
    명시적으로 적어두고, 그 정확한 종류의 다음 작업이 있을 때만 봐준다."""
    if job.status not in (JobStatus.COMPLETED, JobStatus.FAILED):
        return
    song = db.get(Song, job.song_id)
    if song is None or song.status in (SongStatus.COMPLETED, SongStatus.FAILED):
        return
    expected_next_type = _CHAIN_NEXT_JOB_TYPE.get(job.job_type)
    if expected_next_type is not None:
        pending_job = (
            db.query(Job)
            .filter(
                Job.song_id == song.id,
                Job.job_type == expected_next_type,
                Job.status.in_((JobStatus.QUEUED, JobStatus.PROCESSING)),
            )
            .first()
        )
        if pending_job is not None:
            return
    song.status = SongStatus.FAILED
    db.commit()


def process_next_job(db: Session) -> Job | None:
    """가장 오래된 QUEUED 작업 하나를 원자적으로 선점해 처리한다(FIFO: created_at, 동률이면 id 순).
    처리한 Job을 반환하거나, 큐가 비어 있거나(또는 다른 워커가 먼저 선점했으면) None을 반환한다."""
    job = _claim_next_job(db)
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


def register_production_handlers() -> None:
    """실제 작업 처리 함수들을 등록한다. 이 프로세스(`python -m worker.runner`)의
    진입점에서만 호출한다 — `run_once()`/`run_forever()` 안에서 자동 등록하면
    `tests/test_worker.py`의 `clear_handlers()` 기반 테스트 격리가 깨진다.

    REQ-01(T3-1): Demucs 분리. REQ-02 경로 A(T3-2): ADTOF 채보. OMR(Phase 4)은
    핸들러가 생기면 여기 추가한다."""
    from db.models import JobType
    from modules.separator.handler import separate_handler
    from modules.transcriber.handler import transcribe_handler
    from worker.handlers import register_handler

    register_handler(JobType.SEPARATE, separate_handler)
    register_handler(JobType.TRANSCRIBE, transcribe_handler)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    register_production_handlers()
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="작업 하나만 처리하고 종료(수동 QA용)")
    args = parser.parse_args()

    if args.once:
        result = run_once()
        print(f"처리한 작업: {result.id if result else '없음(큐가 비어있음)'}")
    else:
        run_forever()
