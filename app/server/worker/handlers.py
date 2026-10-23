"""작업 종류별 처리 함수 레지스트리. 근거: REQ-10, work/T1-4/plan.md.

REQ-01/02의 실제 처리 로직(Demucs/ADTOF/Audiveris)은 Phase 3·4 범위라 여기선 등록하지 않는다
(CLAUDE.md 절대규칙 6, 범위 밖 작업 금지) — 핸들러가 없는 작업은 worker/runner.py가
크래시 없이 "아직 구현 안 됨"으로 실패 처리한다. Phase 3/4에서 register_handler()로
실제 함수를 등록하면 된다.
"""

from collections.abc import Callable

from db.models import Job, JobType

JobHandler = Callable[[Job], None]

_handlers: dict[JobType, JobHandler] = {}


def register_handler(job_type: JobType, handler: JobHandler) -> None:
    _handlers[job_type] = handler


def get_handler(job_type: JobType) -> JobHandler | None:
    return _handlers.get(job_type)


def clear_handlers() -> None:
    """테스트에서 등록한 핸들러를 되돌리는 용도."""
    _handlers.clear()
