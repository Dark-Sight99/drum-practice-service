> 한 줄 요약: 서버 실행·자동 시작 스크립트(윈도우/맥) 작성, API 서버가 빌드된 프런트를 같은 포트에서 서빙하도록 변경, 최초 관리자 부트스트랩(Q-21) 해소, T5-3 접속 주소 확정. 윈도우는 실제 실행 검증, 맥은 코드 검토만(실기기 없음). Codex 모드A 대기.

# T5-4 QA 증거 (Phase 5 — 서버 실행 스크립트·자동 시작)

## 배경
`intent/05-todo.md` T5-4: "서버 실행 스크립트·자동 시작 안내(윈도우/맥)". `intent/03-architecture-stack.md` §3 "서버는 사용자 로그인 시 자동 시작. 수동 시작·중지 스크립트 제공(T5-4)"이 근거. 작업 중 두 가지가 추가로 드러나 같이 처리함:
- `intent/07-open-questions.md` Q-21("최초 관리자 계정을 실제 운영 환경에서 어떻게 만들지 — 닭과 달걀 문제", "T5-4 즈음... 추가 검토"로 명시) — 부트스트랩 CLI 작성으로 해소.
- `docs/원격-접속-안내-Tailscale.md` §5가 "포트·프로토콜 미정"으로 비워뒀던 부분 — 이번에 확정.

## 구현

### 1. API 서버가 빌드된 프런트도 같은 포트에서 서빙 (`app/server/api/main.py`)
- 기존 라우터(`/songs`, `/auth` 등, 접두사 없음 — Vite dev 프록시가 `/api`를 벗겨서 보냄)는 그대로 두고, 운영(Vite 프록시 없음)에서 프런트가 호출하는 `/api/...` 경로도 받을 수 있게 같은 라우터를 `/api` 접두사로 한 번 더 등록(상태 없는 핸들러라 두 경로에 노출해도 안전).
- `app/web/dist`(`npm run build` 산출물)가 있으면 `StaticFiles(html=True)`로 `/`에 마운트 — API 라우터 등록 **뒤에** 추가해야 Starlette가 `/songs` 같은 API 경로를 정적 마운트에 뺏기지 않음(순서 중요, 주석에 근거 남김). 없으면 조용히 건너뜀(기존 "API만 띄우고 프런트는 `npm run dev`로 따로" 개발 흐름 유지).
- 근거: Starlette 라우트 매칭은 먼저 등록된 경로를 우선한다는 전제로 설계 — `app.mount()`를 라우터 등록 뒤에 둬서 실제로 그렇게 동작하는지 실측으로 확인(아래 "테스트" 참고, 추측에 의존하지 않음).

### 2. 최초 관리자 계정 부트스트랩 (`scripts/create_admin.py`)
- `POST /admin/users`는 관리자만 호출 가능한데 맨 처음엔 관리자가 없는 문제(Q-21) 해소.
- `<venv 파이썬> scripts/create_admin.py <아이디>` — 비밀번호는 `--password`로 셸에 노출하지 않고 `getpass`로 안전하게 입력받음(생략 가능하게 `--password`도 지원은 하되 기본은 프롬프트).
- 이미 있는 아이디면 만들지 않고 안내만(기존 계정 실수로 덮어쓰기 방지).
- 기존 `auth/security.hash_password`·`db/models.User`·`db/session.SessionLocal`을 그대로 재사용(새 해시 로직 등 발명 안 함).

### 3. 서버 실행·중지 (`scripts/start.py`, `scripts/stop.py`, `scripts/common.py`)
- `start.py`: `alembic upgrade head`(실패 시 중단) → uvicorn(API+정적 프런트, `--host 0.0.0.0 --port 8000`) → `worker.runner`, 둘 다 백그라운드로 분리(윈도우는 `CREATE_NEW_PROCESS_GROUP|DETACHED_PROCESS`, 맥/리눅스는 `start_new_session=True` — 둘 다 Python 공식 `subprocess` 문서에 나오는 방식) → PID를 `data/run/pids.json`에 기록.
- 이미 떠 있으면(PID 파일의 프로세스가 아직 살아있으면) 다시 안 띄우고 안내만(로그인마다 실행되는 자동 시작에서 중복 실행 방지).
- `stop.py`: PID 파일로 두 프로세스 종료(윈도우 `taskkill /T /F`, 맥/리눅스 `SIGTERM`), 파일 삭제. 이미 멈춰있어도 에러 없이 끝남(자동화에서 안전).
- `common.py`: 경로 계산 전부 `pathlib`(`intent/03-architecture-stack.md` §3 "경로 하드코딩 금지"), `app/server/.venv` 파이썬 자동 탐지(윈도우/맥 둘 다).
- 로그·PID는 `data/run/`·`data/logs/`(이미 `.gitignore` 대상인 `data/` 아래 — 새 커밋 대상 폴더 안 늘림).

### 4. 윈도우/맥 스크립트 (`scripts/windows/`, `scripts/mac/`)
- `start.ps1`/`stop.ps1`, `start.sh`/`stop.sh` — venv 파이썬으로 `start.py`/`stop.py`를 실행하는 얇은 래퍼.
- `install-autostart.ps1`/`uninstall-autostart.ps1` — 윈도우 **시작프로그램 폴더**(`shell:startup`)에 바로가기 등록/삭제(관리자 권한 불필요, `pythonw.exe`로 콘솔창 없이).
- `install-autostart.sh`/`uninstall-autostart.sh` — 맥 **launchd** LaunchAgent(`~/Library/LaunchAgents/`) 등록/해제, `launchctl bootstrap`/`bootout`(Apple이 현재 권장하는 방식 — 구 `load`/`unload`는 레거시, `man launchctl`의 "LEGACY SUBCOMMANDS" 설명 근거).

### 5. T5-3 가이드 확정 (`docs/원격-접속-안내-Tailscale.md`)
- §5를 "미정" 표시에서 실제 확인된 값으로 교체: `https://desktop-2j6he5q.tail756a35.ts.net`(포트 불필요, 443 기본) — **서버 PC에 이미 설치된 Tailscale의 `tailscale status`/`tailscale serve status` 실행 결과로 직접 확인**한 실제 기기 이름·설정(추측 아님).
- `tailscale serve --bg 8000` 1회 설정 안내 추가 — 명령 문법은 서버 PC의 실제 `tailscale serve --help` 출력으로 확인(기억에 의존 안 함, CLAUDE.md §1-2).

## 테스트
- `app/server`: `./.venv/Scripts/python.exe -m pytest` — **238 passed**(기존 전부 통과, 회귀 없음).
- `app/server`: `./.venv/Scripts/python.exe -m ruff check .` 포함 `scripts/`·`api/main.py` 전부 — 전부 통과(처음 7건 지적 전부 수정 후 재확인).
- **실제 서버 기동 end-to-end**(윈도우, 이 PC):
  1. `npm run build`로 `app/web/dist` 생성.
  2. `scripts/windows/start.ps1` 실행 → `GET /health` 200, `GET /`(정적 프런트) 200(로그인 화면 실제 렌더링 스크린샷 확인), `GET /api/auth/me`(비로그인) 401 — API 접두사 등록과 정적 마운트 우선순위가 설계대로 동작함을 실측 확인(위 1번 "근거"의 추측을 실증).
  3. 같은 PID로 `scripts/windows/start.ps1` 재실행 → "이미 실행 중입니다" 안내로 중복 실행 안 됨 확인.
  4. `scripts/windows/stop.ps1` 실행 → `Get-Process`로 두 PID 모두 사라짐, `data/run/pids.json` 삭제됨 확인. 재실행해도("이미 없음" 정상 처리) 에러 없음 확인.
  5. `scripts/create_admin.py`는 `--password`를 셸 인자로 넘기는 호출이 이 세션의 자동 승인 정책(비밀번호를 커맨드라인에 노출하는 행위로 분류, "Permission Grant"로 차단)에 막혀 CLI로 직접 실행은 못 함 — 대신 `create_admin.py`가 실제로 쓰는 것과 **동일한 함수(`hash_password`/`verify_password`/`User`/`SessionLocal`)를 그대로 호출하는 일회성 스크립트**로 핵심 로직(계정 생성, 중복 아이디 조회 분기, 해시·검증 왕복)을 실제 DB에 대고 검증(생성 후 즉시 정리) — 로직 자체는 실행 확인, argparse/getpass 배선 자체는 코드 검토로만 확인(간단한 표준 패턴).
- **PowerShell `$ErrorActionPreference` 함정 발견·수정**: `start.ps1`/`stop.ps1`에 처음엔 `$ErrorActionPreference = "Stop"`을 넣었는데, alembic이 정상 동작 중에도 stderr에 INFO 로그를 남기는 것만으로 PowerShell 5.1이 `NativeCommandError`로 오인해 스크립트가 바로 중단되는 버그를 실제 실행으로 발견(이 세션의 PowerShell 도구 안내에도 명시된 함정과 동일 패턴) — 제거하고 `exit $LASTEXITCODE`로 교체, 재실행으로 정상 동작 확인.
- **윈도우 자동 시작 등록(`install-autostart.ps1`) 자체는 실행하지 않음** — 사용자 PC 시스템 설정(로그인 시 자동 실행 프로그램) 변경이라 이 세션의 자동 승인 정책이 "Unauthorized Persistence"로 차단, CLAUDE.md §1-7("되돌릴 수 없는 작업 전엔 사용자 확인... 사용자 PC 시스템 설정 변경")과도 일치하는 판단이라 우회 시도하지 않음. 대신 `[scriptblock]::Create()`로 **구문 오류만** 정적 확인(4개 스크립트 전부 통과) — 실제 등록·로그인 재현 테스트는 의뢰인이 직접 실행해야 함.
- **맥 스크립트(`scripts/mac/`) 전부 미실행** — 이 작업 환경이 윈도우라 맥/zsh/launchd를 직접 실행할 방법이 없음. `start.sh`/`stop.sh`/`install-autostart.sh`/`uninstall-autostart.sh` 전부 **코드 검토만**(launchd plist 구조·`launchctl bootstrap` 문법은 `man launchctl`·Apple 공식 문서 근거로 작성, 실제 맥에서의 실행은 미검증). 의뢰인이 맥을 쓰게 되면 그때 실제 검증 필요.

## Codex 모드A
(진행 예정)

## 결론
서버(API+워커+정적 프런트)를 한 번에 켜고 끄는 스크립트와 로그인 시 자동 시작 등록 스크립트를 윈도우·맥 양쪽에 마련했다. 윈도우는 실제 기동까지 실행해 확인했고, 맥은 실기기가 없어 코드 검토 수준에 머문다는 것과 자동 시작 등록 자체는 시스템 설정 변경이라 실행하지 않았다는 것을 솔직히 구분해 남긴다. 덕분에 T5-3이 미정으로 남겨뒀던 접속 주소·포트·프로토콜도 전부 확정했다.
