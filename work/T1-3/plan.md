> 한 줄 요약: T1-3 — argon2 비밀번호 해시 + 서버 세션(HttpOnly 쿠키) 로그인, 관리자 계정 생성/정지, 비로그인·사용자간 접근 차단 테스트.

# T1-3 계획

## 목표
`intent/05-todo.md` T1-3: "로그인/세션, 비로그인 차단 테스트 (REQ-08)".

## 근거
- REQ-08: 로그인 없이 어떤 곡 데이터도 접근 불가, 사용자 A가 B의 라이브러리 접근 불가, 관리자가 계정 생성·정지(가입 화면 없음), 정지 시 즉시 로그인 불가 — 전부 "테스트로 증명" 요구.
- `intent/03-architecture-stack.md` §3: "인증: 비밀번호 해시(argon2 또는 bcrypt) + HttpOnly 세션 쿠키" → argon2 선택(이미 Phase 0에서 설치 확인).

## 설계
- **세션 저장 방식**: 서버 사이드 세션 테이블(`UserSession`). 이유: 계정 정지 시 "즉시" 무효화를 보장하려면 요청마다 DB의 `is_active`를 확인해야 하는데, 세션 토큰 자체도 DB에 두면 로그아웃 시 즉시 삭제(철회)까지 자연스럽게 됨. 쿠키에는 무작위 토큰(`secrets.token_urlsafe(32)`)만 담고, DB에는 그 토큰의 SHA-256 해시만 저장(토큰 자체는 저장하지 않음 — DB 유출 시에도 세션 하이재킹 안 되게).
- **비밀번호**: `argon2-cffi`의 `PasswordHasher`(실행 확인: `.hash()`/`.verify()`, 불일치 시 `VerifyMismatchError`).
- **쿠키**: `httponly=True`, `secure=True`(Tailscale HTTPS 전제), `samesite=lax`.
- **엔드포인트**:
  - `POST /auth/login` {username, password} → 세션 생성, 쿠키 설정
  - `POST /auth/logout` → 세션 DB에서 삭제, 쿠키 제거
  - `GET /auth/me` → 로그인 안 돼 있으면 401
  - `POST /admin/users` (관리자 전용) → 계정 생성(가입 화면 없음, REQ-08)
  - `PATCH /admin/users/{id}` (관리자 전용) → `is_active` 토글(정지/복구)
  - `GET /songs`, `GET /songs/{id}` → REQ-08 "사용자 A가 B의 라이브러리 접근 불가"를 실제로 테스트하기 위한 최소 보호 엔드포인트(목록/상세 조회만, 업로드·편집은 Phase 2 범위)

## 바꿀 파일
```
app/server/db/models.py          UserSession 모델 추가
app/server/alembic/versions/     신규 마이그레이션(세션 테이블)
app/server/auth/security.py      비밀번호 해시, 세션 토큰 생성/해시
app/server/api/deps.py           get_db, get_current_user, require_admin
app/server/api/auth.py           로그인/로그아웃/me
app/server/api/admin.py          계정 생성/정지
app/server/api/songs.py          목록/상세(보호됨, 사용자별 필터)
app/server/api/main.py           라우터 연결
app/server/tests/test_auth.py    테스트
app/server/requirements.txt      argon2-cffi 추가(실제 사용 시작)
```

## 테스트 계획
1. 로그인 성공 → `/auth/me`로 확인
2. 비밀번호 틀림 → 401
3. 정지된 계정 → 로그인 자체가 401
4. 로그인 없이 `/songs` 접근 → 401
5. 사용자 A가 B의 곡 목록/상세에 접근 불가(목록에 안 보이고, 상세는 404)
6. 로그아웃 후 `/auth/me` → 401
7. **이미 로그인된 상태에서 관리자가 계정을 정지하면, 기존 세션 쿠키로도 다음 요청이 즉시 거부됨**(REQ-08 "즉시" 요구사항의 핵심 테스트)
8. 관리자 전용 엔드포인트를 일반 사용자가 호출 → 403

## 가정
- 세션 만료 기간은 임시로 30일(슬라이딩, REQ-09 오프라인 30일과 숫자만 맞춤 — 메커니즘은 다름, 추후 재검토 가능)로 둔다. 정확한 값은 의뢰인 확인 사항이 아니라 구현 세부사항이라 임의로 정하되, `intent/07-open-questions.md`에 "검증 필요"로 올리지 않고 추후 쉽게 바꿀 수 있게 상수로 분리.
- 실제 PWA 오프라인 캐시 삭제(REQ-09)는 클라이언트(Phase 5 T5-2) 몫 — 이번엔 서버가 "세션/계정이 유효한지"를 정확히 응답하는 것까지만.
