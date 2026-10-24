> 한 줄 요약: Codex 모드A(독립 코드 검수) — Minor 1건(APPROVE WITH NOTES). 허용폭 탐색 함수의 주석이 "이분 탐색"이라고 설명했는데 실제 구현은 매번 배열 처음부터 선형 탐색 — 기능상 문제는 없음(경계·사용자 지정 노트 제외 로직 모두 올바름), 주석을 실제 동작(선형 탐색, 당장은 규모상 문제 아님)에 맞게 수정.

# T2-12 Codex 모드A 원문 (2026-10-24)

대상: `branch diff against main` (task/T2-12-feedback-5, `sticking.ts`/`sticking.test.ts`)

## Codex 출력 원문

```
모드: A
Target: task/T2-12-feedback-5 — app/web/src/score/sticking.ts, app/web/src/score/sticking.test.ts (main 대비 diff)
Verdict: APPROVE WITH NOTES

Findings:

- Minor — 성능 설명이 실제 구현과 다릅니다 — app/web/src/score/sticking.ts:66-68,
  sticking.ts:79-84. 주석은 이분 탐색 또는 윈도우 스캔으로 빠르게 찾는다고
  설명하지만, 두 함수 모두 매 호출마다 정렬된 배열을 처음부터 선형 탐색합니다.
  따라서 여러 고정 피스나 스네어가 있으면 최악에는 O(n²) 비교가 발생합니다.
  일반적인 수백~수천 노트 규모에서 즉각적인 성능 문제라고 단정하기는 어렵지만,
  주석과 실제 동작은 일치하지 않습니다. 성능을 의식한 구현이라면 lower bound
  탐색이나 인덱스 기반 윈도우 스캔을 고려할 수 있습니다.

정렬된 배열에서 tick - tolerance보다 작은 항목을 건너뛰고 tick + tolerance보다
큰 항목에서 멈추는 조건은 해당 배열이 오름차순이므로 윈도우 내 항목을 놓치지
않으며 경계도 inclusive입니다. 사용자 지정 hand !== 'R' 노트를 후보 배열에서
제외하는 조건도 유지되어 있습니다. 기능상 확정 가능한 문제는 찾지 못했습니다.

확인하지 못한 것: REQ-11은 현재 수용 기준이 아닌 확인 대기 상태로 표시돼 있어
검수 기준으로 적용하지 않음. 테스트는 실행하지 않음(코드 diff만 정적 검토).
```

## 반영
1. **주석을 실제 동작에 맞게 수정**: 두 탐색 함수(`hasCoincidenceWithinTolerance`, `hasHigherPriorityWithinTolerance`) 모두 "이분 탐색으로 빠르게 찾는다"는 틀린 설명을 "호출마다 배열 처음부터 선형 탐색한다"로 정정하고, 한 곡의 하이햇/라이드/고정 R 피스 개수가 수백 개 수준이라 당장은 성능 문제가 아니라고 판단한 근거와 "더 커지면 이분 탐색으로 바꿀 여지"를 함께 명시.
2. 기능(경계 조건·사용자 지정 노트 제외)은 Codex가 직접 검증해 문제 없음으로 확인 — 코드 변경 없음.
3. `npx tsc -b`(exit 0), `npx oxlint`(exit 0), `npx vitest run`(137/137) 재확인.
