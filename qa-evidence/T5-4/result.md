> 한 줄 요약: 서버 실행·자동 시작 스크립트(윈도우/맥) 작성, API 서버가 빌드된 프런트를 같은 포트에서 서빙하도록 변경, 최초 관리자 부트스트랩(Q-21) 해소, T5-3 접속 주소 확정. 윈도우는 실제 실행 검증, 맥은 코드 검토만(실기기 없음). Codex 모드A 3라운드(PID 재사용 방지 보강) 끝에 APPROVE.

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
- §5를 "미정" 표시에서 실제 확인된 값으로 교체: `https://<서버PC-기기이름>.tail756a35.ts.net`(포트 불필요, 443 기본) — **서버 PC에 이미 설치된 Tailscale의 `tailscale status`/`tailscale serve status` 실행 결과로 직접 확인**한 실제 기기 이름·설정(추측 아님).
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

### 1차 — REQUEST_CHANGES
- **C-001(필수)** `scripts/stop.py`: PID 파일의 PID만 믿고 바로 종료 신호를 보냄 — 그 PID가 죽은 뒤 OS가 전혀 다른 프로그램에 재사용했을 가능성(PID 재사용)을 전혀 검증 안 함.
- **C-002(필수)** `scripts/create_admin.py`: "관리자가 하나도 없을 때만" 쓰려는 의도인데 실제로는 그 전제를 검사 안 해, 다른 아이디로 반복 실행하면 관리자를 계속 추가할 수 있었음(정상적인 "관리자가 계정을 추가로 만드는" 흐름 우회).
- **C-003(필수)** `scripts/windows/start.ps1`·`stop.ps1`: `$ErrorActionPreference = "Stop"` 제거 자체는 타당했지만, 파이썬 실행 자체가 실패하는 경우(권한 문제 등) `$LASTEXITCODE`가 이전 호출 값을 그대로 들고 있어 실패를 성공으로 잘못 보고할 위험.
- C-004(권장)/C-005(권장): 워커 시작 실패 시 API 프로세스 고아화, 윈도우 생존 판정이 tasklist 출력 전체에서 PID 문자열만 찾아 메모리 사용량 칸 등과 혼동될 이론적 위험.
- C-006(리스크 의견): §5 접속 주소가 §5-1(Serve 재설정) 전에는 안 열린다는 선행조건을 한 문장으로 더 명확히.
- Codex가 직접 확인: Starlette 공식 라우팅 문서(등록 순서대로 매칭, 구체 경로를 먼저) 근거로 정적 마운트를 API 라우터 뒤에 두는 설계가 올바름을 확인. `/api` 접두사 중복 등록도 경로가 다르므로 충돌 없음을 확인.

### 대응
- **C-001**: `scripts/common.py`에 `process_image_name()`(윈도우 `tasklist`를 CSV로 정확히 파싱, 맥/리눅스는 `ps -p <pid> -o comm=`)·`is_our_python_process()` 추가. `stop.py`가 종료 직전 이 확인을 거쳐, python 계열이 아니면(재사용 의심) 건너뛰고 경고만 남김.
- **C-002**: 아이디 중복 검사 앞에 "이미 관리자가 1명이라도 있으면 기본 거부" 검사 추가, 복구용 `--force` 플래그로만 우회 가능하게.
- **C-003**: `$LASTEXITCODE`를 실행 전 `0`으로 초기화 + `try/catch`로 호출 자체의 실패(명령을 못 찾음 등)도 명시적으로 `exit 1`.
- **C-004**: 워커 `Popen` 호출을 `try/except OSError`로 감싸, 실패 시 이미 뜬 API 프로세스를 `terminate()`로 정리 후 종료.
- **C-005**: C-001 대응과 같은 `process_image_name()`이 CSV 파싱으로 해결(더 이상 전체 출력 문자열 포함 여부로 안 봄) — `start.py`의 `_pid_alive()`도 이걸 재사용하도록 교체.
- **C-006**: §5 맨 앞에 "⚠ 아래 주소는 §5-1을 먼저 한 번 해야 열립니다" 경고 문장 추가.

### 재검증
- `ruff check`(scripts/ + api/main.py) 전부 통과, `pytest` 238 passed(회귀 없음).
- 실제 재기동: `start.ps1`(새 `_pid_alive` 포함) 정상 기동 → `/health` 200 확인 → `stop.ps1`(새 신원 확인 포함) 정상 종료, `Get-Process`로 두 PID 모두 사라짐 확인.
- `is_our_python_process()` 단위 확인: 실제 PID 4(윈도우 "System" 프로세스, python 아님) → `False` 정상 반환, 존재하지 않는 PID → `False` 정상 반환 — PID 재사용 상황을 실제로 재현하진 못했지만(정상 종료라 재사용 PID 자체가 생기지 않음), "python이 아닌 프로세스는 건너뛴다"는 핵심 로직은 실측 확인.

### 2차 — REQUEST_CHANGES
- **C-001(필수, 재지적)**: 1차 대응("이름이 python인지"만 확인)은 PID가 재사용되더라도 *다른* python 프로세스가 그 번호를 차지한 경우는 못 걸렀음 — 이름만으론 부족, 프로세스 식별 정보(생성 시각 등)까지 비교해야 한다고 재지적.
- **C-002(권장)**: `start.py`의 `_already_running()`도 "그 PID에 아무 프로세스나 살아있으면" 실행 중으로 판단해 같은 PID 재사용 문제에 노출.
- Codex가 직접 확인: tasklist CSV 파싱, `ps` 빈 출력=프로세스 없음 전제, `pythonw.exe` 매칭, `--force` 배선, Windows try/catch 범위, `DETACHED_PROCESS` 프로세스의 `terminate()` 가능 여부, `OSError`가 `Popen` 실패의 올바른 예외 타입인지, Tailscale 안내 문구 정합성 — 전부 문제없음 확인(추가 지적 없음).

### 대응
- **C-001/C-002**: `common.py`에 `process_start_signature(pid)` 추가 — 이미지 이름 + **프로세스 생성 시각**을 합친 서명. 윈도우는 `ctypes`로 Win32 `GetProcessTimes()` 직접 호출(표준 라이브러리만 사용, `PROCESS_QUERY_LIMITED_INFORMATION` 권한은 자기 소유 프로세스엔 관리자 권한 없이도 허용됨 — Microsoft Learn 근거), FILETIME을 정수로 비교(파싱 없음, 가장 정확). 맥/리눅스는 `ps -p <pid> -o lstart=`(고정 포맷 생성 시각 문자열)를 그대로 비교. `is_same_process(pid, 기록된_서명)`로 일치 여부 확인.
- `start.py`가 각 프로세스를 띄운 직후 이 서명을 `data/run/pids.json`에 같이 기록(`api_signature`/`worker_signature`), `_already_running()`도 PID만이 아니라 서명까지 일치해야 "실행 중"으로 판단하도록 교체.
- `stop.py`는 종료 직전 `is_same_process(pid, 기록된_서명)`로 재확인 — 서명이 다르면(PID 재사용 의심) 건너뛰고 경고만 남김.

### 재검증
- `ruff check` 전부 통과, `pytest` 238 passed(회귀 없음).
- **새 ctypes 로직 직접 검증**: 현재 파이썬 프로세스 자신의 PID로 서명 생성 → 같은 PID+같은 서명 비교 시 `True`, 일부러 틀린 서명과 비교 시 `False` 확인. 존재하지 않는 PID(999999)·권한이 없는 PID(4, 윈도우 System 프로세스 — `OpenProcess`가 권한 부족으로 실패)는 둘 다 안전하게 `None`(미검증 취급, "일치 안 함"으로 처리) 확인.
- 실제 재기동: `start.ps1` 정상 기동 → `data/run/pids.json`에 `api_signature`/`worker_signature` 둘 다 기록됨을 직접 확인 → 같은 상태에서 `start.ps1` 재실행 시 서명 비교로 "이미 실행 중" 정상 인식(중복 기동 안 됨) → `/health` 200 확인 → `stop.ps1`로 서명 검증 거쳐 정상 종료, 두 PID 모두 `Get-Process`에서 사라짐 확인.

### 3차 — APPROVE
필수 수정 없음, 권장 사항 없음. Codex가 직접 확인: Windows FILETIME 상위/하위 32비트 결합(`(high << 32) | low`)이 올바름, 핸들은 `finally`에서 확실히 닫힘, `PROCESS_QUERY_LIMITED_INFORMATION`이 Microsoft 공식 문서상 유효한 권한 상수임, POSIX `ps -p PID -o lstart=` 옵션이 리눅스·맥 매뉴얼 양쪽에 다 있음(출력 형식이 플랫폼마다 달라도 기록·비교가 같은 호스트에서 이뤄져 문제 없음), `pids.json`의 `api_signature`/`worker_signature` 필드가 `start.py`→`_already_running()`/`stop.py` 전체에서 일관되게 연결됨, 이전(이미지 이름만 비교하던) 로직의 잔재가 코드·주석 어디에도 안 남아있음. 리스크 의견으로 "서명 확인~종료 요청 사이의 극히 짧은 경합(TOCTOU)은 원자성까지는 보장 못 하지만 단일 사용자 서버 스크립트의 잔여 위험으로는 허용 가능"이라고 명시 — 추가 조치 요구 아님.

## 결론
서버(API+워커+정적 프런트)를 한 번에 켜고 끄는 스크립트와 로그인 시 자동 시작 등록 스크립트를 윈도우·맥 양쪽에 마련했다. 윈도우는 실제 기동까지 실행해 확인했고, 맥은 실기기가 없어 코드 검토 수준에 머문다는 것과 자동 시작 등록 자체는 시스템 설정 변경이라 실행하지 않았다는 것을 솔직히 구분해 남긴다. 덕분에 T5-3이 미정으로 남겨뒀던 접속 주소·포트·프로토콜도 전부 확정했다.
