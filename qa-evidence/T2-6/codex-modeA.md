> 한 줄 요약: Codex 모드A(독립 코드 검수, diff만 보고 report.md/plan.md 미공개) — P1 1건: ppq가 격자 분할 수로 나누어떨어지지 않으면(예: 8분음표 셋잇단) 스냅/이동된 틱이 정수가 아니게 돼 저장 검증에 실패할 수 있음. 실제 재현 확인 후 수정.

# T2-6 Codex 모드A 원문 (2026-10-24)

대상: `branch diff against main` (task/T2-6-editor, 커밋 af794d5까지)

## Codex 출력 원문

```
# Codex Review

Target: branch diff against main

The editor can generate fractional tick positions for valid scores whose PPQ is not evenly divisible by the selected grid division, making edits fail validation or produce inconsistent note timing. This violates the editing flow for those PPQ values.

Review comment:

- [P1] Preserve note positions when changing the grid — app/web/src/features/editor/grid.ts:12-13
  When a user selects the 8th-note triplet grid, `ticksPerGridUnit` returns `ppq / 3`, but MIDI PPQ values are not necessarily divisible by 3 (for example, PPQ 480 yields a 160-tick step, which is fine, while PPQ 100 yields a fractional step). Fractional tick positions then reach `DrumScore` validation/save and are rejected or rounded inconsistently; use integer tick steps or constrain the PPQ/grid combinations.
```

## 재현 확인
`app/web/src/score/validate.ts:57-58`가 `note.tick`에 `Number.isInteger()`를 요구함을 실제 코드로 확인. `grid.ts`의 `snapTick(50, '8nt', 100)`을 직접 계산하면 `ticksPerGridUnit('8nt', 100) = 100/3 = 33.333…`, `Math.round(50/33.333)*33.333 = 2*33.333 = 66.666…` — 정수가 아닌 값이 나옴을 확인(실제 버그, Codex 지적이 맞음).

추가로 `EditorScreen.tsx`의 방향키 이동(`moveSelected`)은 `snapTick`을 거치지 않고 `selectedNote.tick + unitTicks`를 그대로 더하기만 해서, `unitTicks` 자체가 정수가 아닐 때(위와 같은 ppq/격자 조합) snapTick을 고쳐도 이 경로는 여전히 정수가 아닌 틱을 만들 수 있음을 코드 읽기로 추가 발견 — Codex가 짚은 근본 원인(ppq·격자분할 나눗셈)과 같은 종류의 문제가 이동 경로에도 있었다.

## 수정
- `grid.ts`의 `snapTick`: 최종 결과를 `Math.round()`로 한 번 더 감싸 항상 정수를 반환하도록 수정.
- `EditorScreen.tsx`의 `moveSelected`: 직접 덧셈 대신 `snapTick(...)`을 거치도록 변경해 항상 정수·격자정렬 틱을 보장.
- 회귀 테스트 추가: `grid.test.ts`(ppq=100, '8nt'에서 `snapTick` 결과가 정수인지), `EditorScreen.test.tsx`(같은 조합으로 실제 방향키 이동 후 화면에 표시된 틱이 정수인지).

## 재검증
`npx tsc -b`/`npx oxlint`/`npx vitest run` 재실행 — 107/107 PASS(기존 105 + 신규 회귀 2개). 전체 로그: `raw_log.txt`.
