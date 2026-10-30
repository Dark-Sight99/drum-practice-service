"""서버 실행 스크립트 공용 경로·헬퍼. 근거: T5-4(intent/05-todo.md), intent/03-architecture-stack.md
§3 "경로 하드코딩 금지"·"코드는 두 OS 모두에서 동작해야 한다" — 전부 pathlib로 구성.

이 폴더(scripts/)의 다른 스크립트(start.py/stop.py/create_admin.py)가 공통으로 쓰는
경로 계산·venv 파이썬 찾기·PID 파일 위치만 모아둔다. 실행 로직은 각 스크립트에.
"""

from __future__ import annotations

import csv
import platform
import subprocess
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


# 2026-10-30(T5-4) — Codex 모드A 지적(C-001/C-005, 반영). 원래는 PID만 보고 살아있는지
# 확인해 stop.py가 그 PID로 바로 종료 신호를 보냈는데, 그 PID가 우리 프로세스가 죽은 뒤
# OS가 전혀 다른 프로그램에 재사용했을 가능성(PID 재사용)을 전혀 검증하지 않았다 —
# start.py가 기록해둔 "이 PID는 python(.exe)이어야 한다"는 걸 종료 직전에 다시 확인해
# 엉뚱한 프로세스를 죽이는 사고를 막는다. 추가 의존성(psutil 등) 없이 OS 기본 도구만
# 사용(윈도우 tasklist, 맥/리눅스 ps — 둘 다 기본 설치돼 있음).
def process_image_name(pid: int) -> str | None:
    """살아있으면 그 PID의 실행 파일 이름(예: "python.exe", "python3.12")을, 없으면 None."""
    if platform.system() == "Windows":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        line = result.stdout.strip().splitlines()[0]
        if line.upper().startswith("INFO:"):  # tasklist가 "해당 PID 없음"일 때 내는 안내 줄
            return None
        try:
            fields = next(csv.reader([line]))
        except (csv.Error, StopIteration):
            return None
        return fields[0] if fields else None

    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True
    )
    name = result.stdout.strip()
    return name or None


def is_our_python_process(pid: int) -> bool:
    """start.py가 띄운 프로세스가 맞는지(=아직 python 계열인지) 종료 직전 재확인."""
    name = process_image_name(pid)
    return name is not None and "python" in name.lower()
