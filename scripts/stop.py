"""start.py가 띄운 API 서버·워커를 멈춘다. 근거: T5-4, intent/03-architecture-stack.md §3
"수동 시작·중지 스크립트 제공(T5-4)".

실행: `<app/server/.venv 파이썬> scripts/stop.py`

data/run/pids.json에 적힌 PID 두 개(API, 워커)에 종료 신호를 보내고 파일을 지운다.
PID 파일이 없거나 이미 죽어있는 프로세스는 건너뛴다(에러로 치지 않음 — 이미 멈춰있는
상태로 다시 stop을 실행해도 안전해야 자동화 스크립트에서 안심하고 쓸 수 있다).

종료 직전 그 PID가 start.py가 그때 기록해둔 서명(이미지이름+생성시각)과 여전히 일치하는지
재확인한다(common.is_same_process) — 2026-10-30(T5-4) Codex 모드A 지적(C-001, 2차 라운드
반영): 처음엔 "이름이 python인지"만 봤는데, PID가 재사용돼 *다른* python 프로세스가 그
번호를 차지한 경우까지는 못 걸렀다. 프로세스 생성시각까지 비교하면 같은 PID라도 다른
시각에 생긴 프로세스(=재사용된 것)는 구분된다. 서명이 안 맞으면(=PID 재사용 의심) 건너뛰고
경고만 남긴다 — OS가 보장하는 수준에서 가능한 한 정확한 신원 확인(추가 의존성인 psutil
없이 표준 라이브러리/OS 기본 도구만 사용).
"""

from __future__ import annotations

import json
import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import PID_FILE, eprint, is_same_process


def _terminate(pid: int) -> None:
    if platform.system() == "Windows":
        # 출처: Microsoft Learn "taskkill" — /T로 자식 프로세스(uvicorn --reload의 워커 등)까지,
        # /F로 강제 종료. 이미 없는 PID면 에러 코드를 반환하지만 여기선 모든 PID를 어차피
        # "시도"만 하고 넘어가므로 무시해도 안전.
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True
        )
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass  # 이미 죽어있음 — 정상 종료 취급


def main() -> int:
    if not PID_FILE.exists():
        print("실행 중인 기록이 없습니다(data/run/pids.json 없음) — 할 일 없음.")
        return 0

    try:
        data = json.loads(PID_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"PID 파일을 읽지 못했습니다({exc}) — 수동으로 작업 관리자에서 확인해주세요.")
        return 1

    for name, pid_key, sig_key in (
        ("API", "api_pid", "api_signature"),
        ("워커", "worker_pid", "worker_signature"),
    ):
        pid = data.get(pid_key)
        if pid is None:
            continue
        if not is_same_process(pid, data.get(sig_key)):
            eprint(
                f"⚠ {name}(PID {pid})가 이미 없거나 기록된 프로세스와 다릅니다(PID 재사용 "
                "가능성) — 안전하게 건너뜁니다. 작업 관리자에서 직접 확인해주세요."
            )
            continue
        print(f"{name}(PID {pid}) 종료 시도...")
        _terminate(pid)

    time.sleep(0.5)
    PID_FILE.unlink(missing_ok=True)
    print("중지됨.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
