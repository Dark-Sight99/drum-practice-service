"""start.py가 띄운 API 서버·워커를 멈춘다. 근거: T5-4, intent/03-architecture-stack.md §3
"수동 시작·중지 스크립트 제공(T5-4)".

실행: `<app/server/.venv 파이썬> scripts/stop.py`

data/run/pids.json에 적힌 PID 두 개(API, 워커)에 종료 신호를 보내고 파일을 지운다.
PID 파일이 없거나 이미 죽어있는 프로세스는 건너뛴다(에러로 치지 않음 — 이미 멈춰있는
상태로 다시 stop을 실행해도 안전해야 자동화 스크립트에서 안심하고 쓸 수 있다).
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
from common import PID_FILE


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

    for name, key in (("API", "api_pid"), ("워커", "worker_pid")):
        pid = data.get(key)
        if pid is None:
            continue
        print(f"{name}(PID {pid}) 종료 시도...")
        _terminate(pid)

    time.sleep(0.5)
    PID_FILE.unlink(missing_ok=True)
    print("중지됨.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
