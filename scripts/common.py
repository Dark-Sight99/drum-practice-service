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
# 추가 의존성(psutil 등) 없이 OS 기본 도구만 사용(윈도우 tasklist, 맥/리눅스 ps).
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


# 2026-10-30(T5-4) — Codex 모드A 지적(C-001, 2차: "이름이 python인지"만으로는 PID가
# *다른* python 프로세스로 재사용된 경우를 못 걸러낸다). 프로세스 생성 시각까지 같이
# 식별자로 써서 "그 PID가 여전히 우리가 그때 띄운 바로 그 프로세스인지"를 검증한다 —
# 같은 PID라도 생성 시각이 다르면 재사용된 다른 프로세스로 판단.
# 윈도우: ctypes로 Win32 GetProcessTimes() 직접 호출(표준 라이브러리만 사용, 관리자
# 권한 불필요 — PROCESS_QUERY_LIMITED_INFORMATION은 자기 소유 프로세스엔 항상 허용됨,
# 출처: Microsoft Learn "Process Security and Access Rights"). 생성 시각을 100ns
# 단위 FILETIME 정수로 반환 — 파싱 없이 정수 비교라 가장 정확.
# 맥/리눅스: `ps -p <pid> -o lstart=`(생성 시각, 초 단위까지 고정 포맷 문자열)를 그대로
# 문자열 비교 — 같은 포맷으로 항상 나오므로 파싱 없이 비교 가능.
def process_start_signature(pid: int) -> str | None:
    """살아있으면 "이미지이름|생성시각" 형태의 고유 서명을, 없으면 None."""
    name = process_image_name(pid)
    if name is None:
        return None

    if platform.system() == "Windows":
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return None
        try:
            creation = wintypes.FILETIME()
            exit_t = wintypes.FILETIME()
            kernel_t = wintypes.FILETIME()
            user_t = wintypes.FILETIME()
            ok = kernel32.GetProcessTimes(
                handle,
                ctypes.byref(creation),
                ctypes.byref(exit_t),
                ctypes.byref(kernel_t),
                ctypes.byref(user_t),
            )
            if not ok:
                return None
            ticks = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
            return f"{name}|{ticks}"
        finally:
            kernel32.CloseHandle(handle)

    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True
    )
    lstart = result.stdout.strip()
    if not lstart:
        return None
    return f"{name}|{lstart}"


def is_same_process(pid: int, expected_signature: str | None) -> bool:
    """start.py가 기록해둔 서명과 지금 그 PID의 서명이 일치하는지(=PID 재사용 아님)."""
    if not expected_signature:
        return False
    return process_start_signature(pid) == expected_signature
