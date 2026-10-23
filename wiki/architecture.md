> 한 줄 요약: 현재 코드 구조와 각 영역의 실행 방법. 새 작업 시작 전 이 파일부터 확인.

# 아키텍처 현황

## 구조 (T1-1, 2026-10-23)
```
app/web/      Vite + React 19 + TypeScript. PWA(vite-plugin-pwa). 린트=oxlint, 포맷=Prettier, 테스트=Vitest+Testing Library
  src/
    features/{practice,library,editor,mixer,auth}/   화면별 기능(아직 빈 폴더, Phase 2+에서 채움)
    audio/ render/ score/ offline/                    공용 모듈(아직 빈 폴더)
    styles/tokens.css                                 디자인 토큰 — 색·폰트·간격은 여기 한 곳에만(intent/08-design.md §7)

app/server/   FastAPI(Python). 자체 .venv(루트 .venv는 Phase 0 스파이크 전용, 건드리지 않음). 린트=ruff, 테스트=pytest
  api/            FastAPI 앱(현재 /health만)
  worker/         작업 큐 워커(Phase 1 T1-4에서 구현)
  modules/{separator,transcriber,omr,importer}/   REQ-01/02 처리 모듈(인터페이스로 교체 가능하게 설계 예정, 03-architecture-stack.md §1)
  db/             SQLAlchemy 2.0 모델(models.py) + 세션 팩토리(session.py) — T1-2 완료
  alembic/        DB 마이그레이션(초기 리비전 1개)
  storage/        (현재 미사용 — 실제 DB/파일은 루트 data/ 아래. 용도 생기면 채움)

data/         (git 제외) 사용자 음원·악보, Phase 0 스파이크 산출물
qa-evidence/<작업ID>/   QA 증거
work/<작업ID>/          작업 plan.md·report.md
wiki/          이 폴더(architecture.md, decisions.md, tools.md)
logs/          기획 대화·Codex 검수 로그
```

## 실행 방법
```bash
# web
cd app/web
npm install   # 최초 1회
npm run dev       # 개발 서버
npm run lint       # oxlint
npm run test       # vitest
npm run build      # tsc + vite build (PWA 서비스워커 포함)
npm run format     # prettier --check

# server
cd app/server
python -m venv .venv   # 최초 1회
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
./.venv/Scripts/python.exe -m ruff check .
./.venv/Scripts/python.exe -m pytest
```

## DB 스키마 (T1-2, 2026-10-23)
5개 테이블: `users`(계정, is_admin/is_active), `songs`(user_id로 소유, status/needs_review), `assets`(song_id, kind, file_path), `jobs`(user_id+song_id 복합 FK — 다른 사용자 곡 참조 DB 레벨에서 차단), `practice_settings`(song_id 1:1).
- SQLite FK는 `db/session.py`의 `create_sqlite_engine()`으로 연결마다 `PRAGMA foreign_keys=ON` 켜야 동작(기본은 꺼져 있음 — 실제 재현 확인됨).
- enum 컬럼은 `str_enum_column()` 헬퍼로 `.value`(소문자) 저장(기본은 `.name`을 저장해 대문자가 됨 — 실제 재현 확인됨).
- `assets.file_path`는 CHECK 제약으로 `..`/절대경로(`/`,`\`,드라이브 문자)를 막음(완전한 경로 검증은 아님, Phase 3 파일 저장 코드에서 보강 필요).
- 마이그레이션: `cd app/server && ./.venv/Scripts/python.exe -m alembic upgrade head`

## 인증/세션 (T1-3, 2026-10-23)
- 비밀번호: argon2(`auth/security.py`). 세션: 서버 사이드(`user_sessions` 테이블), 쿠키엔 무작위 토큰만, DB엔 SHA-256 해시만 저장.
- `api/deps.py`의 `get_current_user`가 **요청마다** `is_active`를 재확인 — 관리자가 계정을 정지하면 이미 로그인된 세션도 다음 요청부터 바로 막힘(REQ-08 "즉시" 요구사항).
- 로그인 실패(아이디 없음/비밀번호 틀림/계정 정지) 응답은 **내용과 처리 비용을 전부 동일하게** 맞춤 — 계정 존재·상태가 새지 않도록(더미 argon2 해시로 상수 비용 유지).
- 엔드포인트: `POST /auth/login`·`/logout`, `GET /auth/me`, `POST /admin/users`·`PATCH /admin/users/{id}`(관리자 전용, 가입 화면 없음), `GET /songs`·`/songs/{id}`(로그인한 사용자 자신의 곡만 — 다른 사용자 곡은 403이 아니라 404).
- 쿠키는 `httponly`+`secure`+`samesite=lax` — 로컬 테스트 시 `TestClient(app, base_url="https://testserver")`로 HTTPS를 시뮬레이션해야 쿠키가 왕복함(http://testserver 기본값으로는 secure 쿠키가 전송 안 됨).

## 작업 큐 워커 (T1-4, 2026-10-23)
- API 서버(uvicorn)와는 별개 프로세스: `cd app/server && ./.venv/Scripts/python.exe -m worker.runner`(무한 루프) 또는 `--once`(하나만 처리, 수동 QA용).
- `worker/runner.py`: `_claim_next_job()`이 `UPDATE ... WHERE id=? AND status='queued'` 단일 문장으로 작업을 원자적으로 선점 — 워커 프로세스를 2개 이상 띄워도 같은 작업을 이중 처리하지 않음(Codex 모드A C-001, 실제 재현 후 수정). 시작 시 `recover_orphaned_jobs()`가 `PROCESSING`으로 멈춰있는 작업을 전부 `FAILED` 처리(재시작 복구) — 단, 워커 소유자를 구분하지 않아 **워커를 2개 이상 동시에 운영하면** 안전하지 않음(Q-17, 지금은 "워커 1개만 운영"이 전제).
- `worker/handlers.py`: `JobType -> Callable[[Job], None]` 레지스트리, 지금은 비어 있음 — 등록된 핸들러가 없는 작업은 크래시 없이 "구현 안 됨"으로 FAILED 처리(실제 Demucs/ADTOF/Audiveris 연결은 Phase 3/4).
- `db/session.py`의 `SessionLocal`은 `expire_on_commit=False` — 기본값(True)이면 세션을 닫은 뒤 ORM 객체 속성에 접근할 때 `DetachedInstanceError`가 남(실제로 `worker.runner --once`를 독립 서브프로세스로 돌리다 재현됨 — pytest의 `TestClient`/직접 세션 호출 방식은 이 패턴을 안 건드려서 못 잡았음).
- 엔드포인트: `GET /jobs`(내 작업 목록), `GET /jobs/{id}`(다른 사용자 작업은 404 — songs.py와 동일 원칙). 큐에 작업을 **넣는** API는 아직 없음(업로드 플로우가 Phase 3 범위).

## 아직 없는 것 (다음 작업)
- 큐에 작업을 넣는 공개 API(업로드 트리거), 실제 처리 핸들러(Demucs/ADTOF/Audiveris) 등록 — Phase 3/4
- DrumScore 타입·GM 매핑 (T1-5)
- 실제 화면(연습·라이브러리·편집·믹서)은 Phase 2부터
- 관리자 콘솔 UI 없음(API만) — 계정 생성은 지금은 API 직접 호출 필요
