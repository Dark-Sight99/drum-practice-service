"""서버(API+정적 프런트)와 워커를 함께 띄운다. 근거: T5-4(intent/05-todo.md),
intent/03-architecture-stack.md §3 "서버는 사용자 로그인 시 자동 시작. 수동 시작·중지
스크립트 제공(T5-4)".

실행: `<app/server/.venv 파이썬> scripts/start.py` (프로젝트 루트 어디서 실행해도 동작 —
경로는 common.py가 __file__ 기준으로 전부 계산).

하는 일(실패하면 멈추고 알려준다, 다음 단계로 넘어가지 않음):
  1. `alembic upgrade head` — DB 스키마를 최신으로(매번 실행해도 안전,
     이미 최신이면 아무 일도 안 함).
  2. uvicorn(API + app/web/dist 정적 파일, 아래 "정적 프런트" 참고)을 백그라운드로.
  3. worker.runner(작업 큐, REQ-10 "브라우저를 닫아도 계속 진행")를 백그라운드로.
  4. 두 프로세스의 PID를 data/run/pids.json에 기록 — stop.py가 이 파일로 찾아서 끈다.

정적 프런트: app/web/dist가 있으면(= `npm run build` 한 번 해뒀으면) api/main.py가 그걸
같은 포트로 같이 서빙한다(T5-4에서 추가 — 이전엔 Vite 개발 서버를 따로 띄워야 했음).
dist가 없으면 API만 떠서 경고만 출력하고 계속 진행(개발 중 "프런트는 npm run dev로 따로
보고 있다" 상황도 막지 않기 위함).

이미 떠 있으면(PID 파일의 프로세스가 아직 살아있으면) 그대로 두고 안내만 하고 종료한다
— 자동 시작(로그인마다 실행)에서 중복 실행을 막기 위함.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    LOG_DIR,
    PID_FILE,
    SERVER_DIR,
    WEB_DIST_DIR,
    ensure_run_dirs,
    eprint,
    server_venv_python,
)


def _pid_alive(pid: int) -> bool:
    if platform.system() == "Windows":
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True
        ).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # 프로세스는 있지만 신호 보낼 권한이 없다는 뜻 — 즉 살아있음
    except OSError:
        return False


def _already_running() -> dict | None:
    if not PID_FILE.exists():
        return None
    try:
        data = json.loads(PID_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if _pid_alive(data.get("api_pid", -1)) or _pid_alive(data.get("worker_pid", -1)):
        return data
    return None


def _popen_detached(args: list[str], cwd, log_path) -> subprocess.Popen:
    log_file = open(log_path, "a", encoding="utf-8")
    kwargs: dict = {"cwd": str(cwd), "stdout": log_file, "stderr": subprocess.STDOUT}
    if platform.system() == "Windows":
        # 터미널(또는 로그인 자동시작 당시의 부모 프로세스)이 닫혀도 자식이 같이 안 죽게.
        # 출처: Python 공식 문서 subprocess — CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS.
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True  # POSIX: 새 세션으로 분리(맥) — setsid와 동일 효과
    return subprocess.Popen(args, **kwargs)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="uvicorn 바인드 호스트(기본 0.0.0.0 — 다른 기기에서도 접속 가능하게, "
        "Tailscale 전용망 안에서만 노출됨)",
    )
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    running = _already_running()
    if running:
        print(
            f"이미 실행 중입니다(API PID {running.get('api_pid')}, 워커 PID "
            f"{running.get('worker_pid')}) — 다시 시작하려면 먼저 stop.py를 실행하세요."
        )
        return 0

    ensure_run_dirs()
    python = server_venv_python()

    print("1/3 DB 마이그레이션(alembic upgrade head)...")
    migrate = subprocess.run(
        [str(python), "-m", "alembic", "upgrade", "head"], cwd=str(SERVER_DIR)
    )
    if migrate.returncode != 0:
        eprint("DB 마이그레이션 실패 — 서버를 띄우지 않습니다. 위 오류를 먼저 확인해주세요.")
        return 1

    if not (WEB_DIST_DIR / "index.html").exists():
        eprint(
            "⚠ app/web/dist가 없습니다 — API만 뜹니다(화면은 안 뜸). "
            "화면까지 같이 쓰려면 app/web에서 'npm run build'를 먼저 실행하세요."
        )

    print("2/3 API 서버(uvicorn) 시작...")
    api_proc = _popen_detached(
        [
            str(python),
            "-m",
            "uvicorn",
            "api.main:app",
            "--host",
            args.host,
            "--port",
            str(args.port),
        ],
        cwd=SERVER_DIR,
        log_path=LOG_DIR / "server.log",
    )

    print("3/3 작업 큐 워커(worker.runner) 시작...")
    worker_proc = _popen_detached(
        [str(python), "-m", "worker.runner"],
        cwd=SERVER_DIR,
        log_path=LOG_DIR / "worker.log",
    )

    time.sleep(1.5)  # 둘 다 즉시 죽는(설정 오류 등) 흔한 실패를 바로 잡아내기 위한 짧은 대기
    api_alive = api_proc.poll() is None
    worker_alive = worker_proc.poll() is None
    if not api_alive or not worker_alive:
        eprint(
            f"⚠ 바로 종료된 프로세스가 있습니다(API 생존={api_alive}, 워커 생존={worker_alive}) — "
            f"{LOG_DIR}의 로그를 확인하세요."
        )

    PID_FILE.write_text(
        json.dumps(
            {
                "api_pid": api_proc.pid,
                "worker_pid": worker_proc.pid,
                "host": args.host,
                "port": args.port,
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"시작됨 — API PID {api_proc.pid}, 워커 PID {worker_proc.pid}")
    print(f"접속: http://localhost:{args.port} (같은 PC)")
    print("원격 접속 주소는 docs/원격-접속-안내-Tailscale.md 참고")
    print(f"로그: {LOG_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
