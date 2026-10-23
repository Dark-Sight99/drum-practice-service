> 한 줄 요약: T1-1 저장소 구조·린트·테스트 러너 세팅 계획(app/web, app/server 스캐폴드).

# T1-1 계획

## 목표
`03-architecture-stack.md` §5의 목표 폴더 구조대로 `app/web`(Vite+React+TS+PWA), `app/server`(FastAPI) 스캐폴드를 만들고, 각각 린트·테스트 러너가 실제로 동작하는 것까지 확인한다.

## 근거
- `intent/05-todo.md` Phase 1 T1-1 (특정 REQ 번호 없음, 인프라 작업)
- 폴더 구조: `intent/03-architecture-stack.md` §5
- 기술 스택: `intent/03-architecture-stack.md` §3 (React+TS+Vite, vite-plugin-pwa, Python 3.11+/FastAPI/Uvicorn, Vitest/pytest)
- 디자인 토큰 파일 위치: `intent/08-design.md` §7 (`app/web/src/styles/tokens.css`)

## 바꿀 파일 (새로 생성)
```
app/web/           Vite+React+TS 프로젝트(package.json, vite.config.ts, tsconfig, ESLint/Prettier, Vitest, src/ 폴더 뼈대)
app/server/         FastAPI 프로젝트(pyproject.toml, 자체 venv, ruff 설정, pytest, 폴더 뼈대)
.gitignore          app/web/node_modules, app/server/.venv 등 이미 커버되는지 확인(기존 패턴 재사용)
```
기존 파일 수정 없음(순수 추가).

## 테스트 계획
- web: `npm run lint`, `npm run test`(Vitest, 더미 컴포넌트 테스트 1개), `npm run build`(프로덕션 빌드 성공 확인)
- server: `ruff check`, `pytest`(더미 엔드포인트 테스트 1개 — FastAPI TestClient로 헬스체크)
- 두 쪽 다 실제 명령 실행 로그를 `qa-evidence/T1-1/`에 남긴다.

## 가정
- 패키지 버전은 설치 시점 npm/pip가 주는 최신 호환 버전을 쓰고, 실제 설치·실행 로그로 근거를 남긴다(추측 금지, CLAUDE.md 규칙 2).
- `app/server`는 Phase 0 스파이크용 루트 `.venv`(torch/demucs 등 무거운 의존성 포함)와 분리된 자체 venv를 둔다 — 실제 서비스 의존성만 깔끔하게 유지하기 위함.
