> 한 줄 요약: argon2 비밀번호 해시 + 서버 세션(HttpOnly/Secure 쿠키) 로그인·로그아웃·관리자 계정 관리 구현. REQ-08 수용 기준 전부 테스트로 증명.

# T1-3 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/server/auth/security.py` | argon2 비밀번호 해시, 세션 토큰 생성/해시, `utcnow_naive()` | REQ-08, `03-architecture-stack.md` §3 |
| `app/server/db/models.py` | `UserSession` 모델 추가 | 세션 저장(서버 사이드) |
| `app/server/alembic/versions/...add_user_sessions_table.py` | 증분 마이그레이션 | T1-2 스키마에 증분 |
| `app/server/api/deps.py` | `get_db`, `get_current_user`(요청마다 is_active 재확인), `require_admin` | REQ-08 "즉시" 요구사항 |
| `app/server/api/auth.py` | `/auth/login`, `/auth/logout`, `/auth/me` | REQ-08 |
| `app/server/api/admin.py` | `/admin/users`(생성), `/admin/users/{id}`(정지/복구) | REQ-08("가입 화면 없음, 관리자가 생성·정지") |
| `app/server/api/songs.py` | `/songs`, `/songs/{id}`(읽기 전용, 소유자만) | REQ-08 수용 기준 테스트용 최소 보호 엔드포인트 |
| `app/server/tests/test_auth.py` | 테스트(최종 13개 — Codex 모드A 반영분 포함, 아래 섹션 참고) | 테스트 계획(`work/T1-3/plan.md`) |

## 구현 근거 (실행 결과로 확인)
- `argon2.PasswordHasher`의 `.hash()`/`.verify()` 동작과 `VerifyMismatchError`를 실제로 실행해 확인 후 사용.
- `fastapi.Response.set_cookie` 시그니처를 설치 버전(`inspect.signature`)으로 확인 후 `httponly`/`secure`/`samesite` 인자 사용.
- **발견한 문제 1**: SQLite `DateTime` 컬럼은 타임존 정보를 보존하지 않음 — 처음엔 `datetime.now(UTC)`(aware)로 저장하고 읽어올 때 `.replace(tzinfo=UTC)`로 되살리려 했으나, naive/aware 혼용 버그 위험이 커서 **전부 naive-UTC로 통일**(`auth/security.py`의 `utcnow_naive()` 한 곳에서만 "현재 시각"을 만들도록 강제).
- **발견한 문제 2(실제 테스트 실패로 재현)**: FastAPI `TestClient`는 엔드포인트를 별도 워커 스레드에서 실행하는데, `sqlite:///:memory:`를 기본 설정으로 쓰면 "SQLite objects created in a thread can only be used in..." 에러가 남 → `StaticPool` + `check_same_thread=False`로 모든 스레드가 같은 연결 하나를 공유하도록 수정(`tests/test_auth.py`).
- **발견한 문제 3(실제 테스트 실패로 재현)**: 로그인 쿠키를 `secure=True`로 설정했더니, `TestClient`의 기본 `base_url`(`http://testserver`, HTTP)에서는 쿠키가 저장·전송되지 않아 로그인 직후 모든 요청이 401로 실패함 → `TestClient(app, base_url="https://testserver")`로 테스트 전송을 HTTPS로 맞춤(프로덕션 코드의 `secure=True`는 그대로 유지 — 테스트를 쉽게 하려고 보안 설정을 낮추지 않음).
- 로그아웃은 "그 기기(쿠키)의 세션만" 삭제하도록 설계(처음엔 해당 사용자의 모든 세션을 지우려다, 여러 기기(폰/태블릿/PC)에서 쓰는 실사용 패턴(`intent/03-architecture-stack.md`, 여러 기기 접근 요구)과 안 맞아 수정).
- 곡 상세 조회(`GET /songs/{id}`)에서 다른 사용자 소유 곡은 403이 아니라 404로 응답 — 곡 id의 존재 자체를 다른 사용자에게 흘리지 않기 위함(REQ-08 "사용자간 완전 분리" 취지를 더 엄격하게 해석).

## 실행한 검증
`qa-evidence/T1-3/result.md`, `raw_log.txt` — ruff PASS, pytest 29/29 PASS(T1-3 신규 13개 포함, Codex 모드A 반영 테스트 포함 최종 수치).

## 가정
- 세션 유효기간 30일(슬라이딩)은 구현 세부사항으로 임의 설정 — `intent/07-open-questions.md`에 올리지 않음(의뢰인 확인이 필요한 사실이 아니라 쉽게 바꿀 수 있는 상수 `SESSION_LIFETIME_DAYS`).
- REQ-09의 "오프라인 30일" 로직(클라이언트 PWA 캐시 유효기간)은 이번 범위 밖(Phase 5 T5-2) — 서버는 세션 유효성만 정확히 응답.
- `/songs` 엔드포인트는 REQ-08 테스트용 최소 구현(목록/상세 조회만). 업로드·검색·이름변경·삭제(REQ-07)는 Phase 2.

## 질문
- 없음.

## 남은 문제
- 작업 큐 워커는 T1-4.
- 실제 관리자 콘솔 UI는 없음(지금은 API만) — 의뢰인이 계정을 만들려면 당장은 API를 직접 호출하거나 간단한 CLI 스크립트가 필요. Phase 2 이후 UI 필요 여부는 의뢰인과 상의.

## Codex 모드 A 검수 반영 (2026-10-23)
- **C-001**(필수): (1) 정지된 계정이 "계정이 정지됐습니다"라는 별도 메시지를 받아 계정 존재·상태가 새고, (2) 존재하지 않는 사용자는 argon2 검증을 건너뛰어 응답 시간으로 계정 존재 여부를 추측할 수 있다는 지적 — **재현 확인**(코드 구조상 명백함). 두 가지를 각각 다르게 다룸:
  - 응답 **내용**(상태코드·본문) 통일: 사용자 없음/비밀번호 틀림/계정 정지 셋 다 완전히 같은 401 응답으로 수정하고, `test_login_failures_return_identical_response`로 **실제 테스트 검증함**.
  - 응답 **시간**(타이밍) 동등화: 사용자가 없어도 더미 해시로 항상 argon2 검증을 수행하도록 코드를 고쳐 "같은 비용이 들도록" 설계함. 단 이건 **실행 시간을 측정하는 테스트로 증명한 건 아님**(pytest로 나노초 단위 타이밍 차를 안정적으로 재긴 어려움) — 코드 구조상 두 경로 모두 argon2 해시 검증을 거친다는 점만 확인.
- **C-002**(권장): 관리자 계정 생성 API에서 `is_admin`을 직접 지정할 수 있어 관리자가 다른 관리자를 만들 수 있다는 지적 — **수정 안 함(판단 보류), `intent/07-open-questions.md` Q-16으로 등록함**. REQ-08 설계상 관리자는 의뢰인 1명이 소수 지인 계정을 관리하는 구조라 심각한 취약점은 아니라고 판단했으나, 여러 관리자를 허용할지는 제품 정책 결정이라 임의로 좁히지 않음.
- **C-003**(권장): 정지 계정 응답 구분 여부, 변조된 세션 토큰 거부 여부, 세션 토큰이 해시로만 저장되는지를 테스트가 검증하지 않는다는 지적 — **재현 확인 후 전부 추가**(`test_login_failures_return_identical_response`, `test_tampered_session_token_rejected`, `test_session_token_stored_only_as_hash`). 변조 토큰 테스트 작성 중 httpx 쿠키 jar가 domain이 다르면 같은 이름이라도 기존 쿠키를 안 바꾸고 추가만 한다는 것을 실제로 확인해 `client.cookies.clear()`를 먼저 호출하도록 수정.
