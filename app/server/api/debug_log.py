"""임시 진단 로그 수집 — T6-11 "연습↔편집 화면을 여러 번 오가며 BPM을 바꾸면
웹앱이 스스로 새로고침된다" 재현 조사용(2026-10-31, 의뢰인 보고).

> 한 줄 요약: 프런트가 보내는 스템 버퍼 풀 생성/해제·화면 마운트·새로고침 여부
> 이벤트를 qa-evidence/T6-11-memory-diag/client-debug.jsonl에 줄 단위 JSON으로
> 쌓는다. 조사가 끝나면 이 파일·라우터 등록(main.py)·프런트 호출 코드
> (audio/memoryDiag.ts와 그 호출부)를 전부 삭제한다 — 운영에 남길 코드가 아님.
"""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from db.models import User
from file_storage import PROJECT_ROOT

router = APIRouter(tags=["debug"])

_LOG_DIR = PROJECT_ROOT / "qa-evidence" / "T6-11-memory-diag"
_LOG_FILE = _LOG_DIR / "client-debug.jsonl"


class ClientLogIn(BaseModel):
    event: str
    data: dict[str, Any] = {}


@router.post("/debug/client-log", status_code=204)
def post_client_log(
    payload: ClientLogIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    line = {
        "ts": datetime.now(UTC).isoformat(),
        "user_id": user.id,
        "event": payload.event,
        "data": payload.data,
    }
    # 동시에 여러 탭/기기가 로그를 보낼 수 있어 매 호출마다 열고 바로 닫는다
    # (장시간 열어두는 핸들 없음 — append 모드라 여러 프로세스/요청이 섞여도
    # 줄 단위로는 안전).
    with _LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")
