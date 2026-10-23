> 한 줄 요약: T1-1 QA — web(lint/test/build)·server(lint/test) 전부 통과.

# T1-1 QA 결과(2026-10-23)

## 대상
`work/T1-1/plan.md`의 app/web, app/server 스캐폴드.

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| web lint | `npm run lint` (oxlint) | PASS (지적 0건) |
| web test | `npm run test` (vitest run) | PASS (1/1 테스트) |
| web build | `npm run build` (tsc -b && vite build) | PASS, PWA 서비스워커(`sw.js`) 생성 확인 |
| web format | `npm run format` (prettier --check) | PASS |
| server lint | `ruff check .` | PASS (지적 0건) |
| server test | `pytest -v` | PASS (1/1 테스트, `/health` 엔드포인트) |

전체 로그: `raw_log.txt`

## 수용 기준(T1-1) 충족 여부
- [x] 저장소 구조 세팅(web, server) — `03-architecture-stack.md` §5 폴더 구조대로
- [x] 린트·테스트 러너 세팅 — 둘 다 실제 실행으로 동작 확인(더미 코드가 아니라 실제 PASS 결과)
- [x] `.gitignore` 확인 — `app/server/.venv`, `app/web/node_modules`, `app/web/dist` 모두 기존 루트 `.gitignore` 패턴으로 커밋 제외됨(`git add --dry-run`으로 확인)
- [x] `CLAUDE.md` §5 git 규칙 적용 — `task/T1-1-repo-scaffold` 브랜치에서 작업
