> 한 줄 요약: app/web(Vite+React+TS+PWA), app/server(FastAPI) 스캐폴드 완료. 린트·테스트·빌드 전부 실제 실행으로 통과 확인.

# T1-1 보고

## 변경 내용 (파일 → 근거)
| 파일/경로 | 내용 | 근거 |
|---|---|---|
| `app/web/` 전체 | Vite+React+TS 스캐폴드, vite-plugin-pwa, Vitest+Testing Library, oxlint, Prettier | `intent/05-todo.md` T1-1, `intent/03-architecture-stack.md` §3,5 |
| `app/web/src/{features/*,audio,render,score,offline}` | 목표 폴더 구조(빈 폴더 `.gitkeep`) | `intent/03-architecture-stack.md` §5 |
| `app/web/src/styles/tokens.css` | 디자인 토큰(색·간격·반경) | `intent/08-design.md` §2,3,5,7 |
| `app/web/src/App.tsx`, `App.test.tsx` | Vite 기본 데모 콘텐츠 제거, 최소 플레이스홀더 + 스모크 테스트 | Phase 2 전까지 임시 |
| `app/server/` 전체 | FastAPI 스캐폴드(`api/main.py` `/health`), 자체 `.venv`, ruff, pytest | `intent/05-todo.md` T1-1, `intent/03-architecture-stack.md` §3,5 |
| `app/server/{api,worker,modules/{separator,transcriber,omr,importer},db,storage}` | 목표 폴더 구조 | `intent/03-architecture-stack.md` §5 |

## 구현 근거 (실행 결과로 확인, 추측 없음)
- `npm create vite@latest app/web -- --template react-ts` 실행 결과: React 19.3.1, Vite 8.3.4, TypeScript 6.0.3, 기본 린터가 **oxlint**(ESLint 아님 — 최신 Vite 템플릿이 바뀜, `package.json` 확인).
- `vite-plugin-pwa@2.0.0` 사용법은 설치된 패키지의 `node_modules/vite-plugin-pwa/README.md`에서 직접 확인(`VitePWA()` 플러그인 등록 패턴).
- Vitest 설정은 `vitest/config`의 `defineConfig`가 vite+vitest 옵션을 병합 제공함을 `node_modules/vitest/dist/config.d.ts`에서 확인 후 적용.
- `@testing-library/jest-dom`을 기본 경로로 import하면 Vitest의 `expect` 타입에 매처가 안 붙어 `tsc -b`가 실패함(`toBeInTheDocument` 타입 오류, 실제 재현) → 패키지의 `exports` 필드(`package.json`)에서 `/vitest` 전용 서브패스를 발견, `@testing-library/jest-dom/vitest`로 교체해 해결.
- FastAPI `TestClient`를 생성하면 "Using httpx with starlette.testclient is deprecated; install httpx2 instead" 경고가 실제로 떠서(`fastapi.testclient` 임포트 시 재현), `httpx2`를 설치해 경고 제거 확인.
- 이상 전부 **기억에 의존하지 않고 설치된 버전의 실제 동작/문서로 확인**(CLAUDE.md 절대규칙 2).

## 실행한 검증
`qa-evidence/T1-1/result.md`, `raw_log.txt` 참고 — web(lint/test/build/format), server(ruff/pytest) 전부 PASS.

## 가정
- 패키지 버전 고정(`package-lock.json`, `pip freeze`)은 이번엔 최소 `requirements.txt`/`requirements-dev.txt`로만 관리(버전 핀 없음) — Phase 1 후반에 CI를 붙일 때 버전 고정 전략(예: `pip-compile`) 재검토 필요.
- `app/server`를 위한 별도 `.venv`를 새로 만듦(Phase 0 스파이크용 루트 `.venv`와 분리) — 실제 서비스 의존성을 깔끔하게 유지하기 위함. 루트 `.venv`는 그대로 두고 건드리지 않음.

## 질문
- 없음(이번 작업 범위 안에서 막힌 결정 없음).

## 남은 문제
- `app/web`, `app/server` 둘 다 아직 실제 기능 없음(Phase 1 T1-2~T1-5, Phase 2에서 채움).
- CI(자동 빌드/테스트) 파이프라인은 이번 범위 밖 — 필요 여부는 사용자와 별도 논의.
