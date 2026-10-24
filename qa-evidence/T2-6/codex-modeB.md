> 한 줄 요약: Codex 모드B(보고서 대조, 1회차) — needs-attention. (1) 수동 QA·PUT 횟수 주장을 당시 raw_log.txt(자동 명령 출력만)로 교차검증 불가(medium), (2) vitest 신규 테스트의 파일별 개수 분해가 로그로 확인 불가(low). 둘 다 증거 보강으로 해결.

# T2-6 Codex 모드B 원문 (2026-10-24)

대상: `branch diff against main` + `work/T2-6/report.md`, `qa-evidence/T2-6/result.md`, `qa-evidence/T2-6/raw_log.txt`, `qa-evidence/T2-6/codex-modeA.md` 교차 대조

## Codex 출력 원문

```
# Codex Adversarial Review

Target: branch diff against main
Verdict: needs-attention

정적 명령의 최종 수치는 raw_log와 대체로 맞지만, 보고서가 핵심 수동 브라우저 QA와 PUT 횟수를 raw_log가 입증하는 것처럼 인용합니다. 실제 로그에는 해당 기록이 없습니다.

Findings:
- [medium] 수동 QA 및 API 요청 횟수를 raw_log로 검증할 수 없음 (qa-evidence/T2-6/result.md:31-42)
  result.md는 실제 브라우저에서 편집·저장·새로고침·PracticeCanvas 반영을 확인했고 `PUT /songs/2/drumscore`가 정확히 1회, 전체 PUT 2회였다고 주장합니다(31–42행). 하지만 raw_log.txt에는 tsc, oxlint, prettier, vitest, ruff, pytest, Alembic 명령 출력만 있고 브라우저 조작 기록이나 서버 로그가 없습니다. 따라서 지정된 증거 묶음만으로 이 PASS와 횟수를 교차검증할 수 없으며, report.md의 동일한 QA 완료 주장도 diff만으로는 확인되지 않습니다. 수동 검증을 자동 명령 결과와 구분해 표시하고, 서버 로그나 재현 가능한 QA 기록을 증거로 연결해야 합니다.
  Recommendation: 브라우저 QA의 실제 기록과 PUT 로그를 별도 증거 파일로 추가하고 result.md/report.md에서 직접 참조하세요. 그 기록이 없다면 해당 PASS 및 요청 횟수 주장을 확인 불가로 낮추세요.
- [low] 107/107의 테스트 구성 세부 내역은 raw_log에서 확인 불가 (qa-evidence/T2-6/result.md:11)
  최종 vitest 출력은 107 passed를 확인하지만, `81 기존 + 26 신규`와 신규 테스트 파일별 개수(특히 EditorScreen RTL 10개) 분해는 raw_log에 출력되지 않습니다. diff는 테스트 추가 사실은 보여도 실제 실행에 포함된 파일별 테스트 개수를 증명하지 않습니다. 총합 수치 자체는 로그와 일치합니다.
  Recommendation: 파일별 테스트 수 분해가 중요하면 vitest의 상세 리포터 출력이나 별도 집계 근거를 첨부하고, 아니면 전체 107/107 결과만 보고하세요.

Next steps:
- 브라우저 QA 기록과 서버 PUT 로그를 증거로 보강하거나, result.md/report.md의 해당 주장을 확인 불가로 조정하세요.
```

## 반영
- **medium**: 실제 수동 QA 중 받은 uvicorn 서버 접근 로그에서 `PUT|GET /songs/2/drumscore` 줄만 추출해 `qa-evidence/T2-6/server-log-excerpt.txt`로 커밋 — `PUT`이 정확히 2건(추가 1건, 원복 1건) 모두 `204 No Content`임을 로그 원문으로 직접 확인 가능하게 하고, `result.md`가 이 파일을 참조하도록 수정.
- **low**: `npx vitest run --reporter=verbose` 출력을 `raw_log.txt`에 추가 — `src/features/editor/*.test.ts(x)` 파일별 테스트 개수(grid 7, editHistory 6, velocity 3, EditorScreen RTL 10, 합계 26)를 명령 출력으로 직접 확인. 기존에 "App.test.tsx 기존 1개"라고 적었던 부분은 실제로는 2개(T2-6과 무관, T2-5 소유)였음을 verbose 출력으로 발견해 혼동을 피하려 해당 언급 자체를 삭제.
