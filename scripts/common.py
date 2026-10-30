"""서버 실행 스크립트 공용 경로·헬퍼. 근거: T5-4(intent/05-todo.md), intent/03-architecture-stack.md
§3 "경로 하드코딩 금지"·"코드는 두 OS 모두에서 동작해야 한다" — 전부 pathlib로 구성.

이 폴더(scripts/)의 다른 스크립트(start.py/stop.py/create_admin.py)가 공통으로 쓰는
경로 계산·venv 파이썬 찾기·PID 파일 위치만 모아둔다. 실행 로직은 각 스크립트에.
"""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = PROJECT_ROOT / "app" / "server"
WEB_DIR = PROJECT_ROOT / "app" / "web"
WEB_DIST_DIR = WEB_DIR / "dist"

# data/는 .gitignore 대상(사용자 데이터 폴더, CLAUDE.md §5 "커밋 금지: data/") — 실행
# 산출물(로그·PID)도 같이 둔다. 별도 run/ 폴더를 새로 커밋 대상에 추가하지 않기 위함.
RUN_DIR = PROJECT_ROOT / "data" / "run"
LOG_DIR = PROJECT_ROOT / "data" / "logs"
PID_FILE = RUN_DIR / "pids.json"


def server_venv_python() -> Path:
    """app/server/.venv 안의 파이썬 실행파일 경로(윈도우/맥 둘 다 지원).

    T3-1 QA(result.md)에서 이미 app/server/.venv를 실제 운영 venv로 써왔음 — 그 전제를
    그대로 따른다(루트 .venv는 Phase 0 스파이크 전용, 건드리지 않음).
    """
    venv_dir = SERVER_DIR / ".venv"
    candidates = [
        venv_dir / "Scripts" / "python.exe",  # Windows
        venv_dir / "bin" / "python",  # 맥/리눅스
    ]
    for c in candidates:
        if c.exists():
            return c
    raise FileNotFoundError(
        f"{venv_dir}에서 파이썬을 못 찾았습니다 — app/server에서 "
        "'python -m venv .venv' 후 'pip install -r requirements.txt -r requirements-dev.txt'로 "
        "먼저 가상환경을 만들어주세요."
    )


def ensure_run_dirs() -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)
