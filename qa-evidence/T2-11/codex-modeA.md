> 한 줄 요약: Codex 모드A(독립 코드 검수) — Minor 1건. 고정 'R' 피스 동시틱 맵이 handSource를 안 가려 사용자가 하이햇을 'L'로 직접 지정해도 그 틱이 여전히 "하이햇이 R을 쥐고 있다"로 집계돼, 같은 틱 크래시가 불필요하게 'L'로 밀려나 새 충돌(하이햇·크래시 둘 다 L)을 만들 수 있었음 — 사용자 지정 노트 중 손이 'R'이 아닌 것은 맵에서 제외해 반영.

# T2-11 Codex 모드A 원문 (2026-10-24)

대상: `branch diff against main` (task/T2-11-feedback-4, `laneRenderer.ts`/`sticking.ts`/`sticking.test.ts`)

## Codex 출력 원문

```
## Target

`task/T2-11-feedback-4` vs `main` — `laneRenderer.ts`, `sticking.ts`, `sticking.test.ts`

## Verdict

**REQUEST CHANGES**

## Findings

- **Minor — `app/web/src/score/sticking.ts:67–70, 73–79, 94–100`** — The coincidence map
  counts every fixed-priority note, including user-set notes, but the function then returns
  user-set notes unchanged. As a result, a user-set hihat assigned `L` still causes a
  coincident auto crash to be demoted to `L`; the rule can therefore create two `L`
  assignments instead of resolving an actual same-hand collision. Build the priority map
  from the effective assigned hands, or otherwise exclude user-set notes that are not
  assigned `R`.
```

## 반영
1. **사용자 지정 노트를 "R 점유" 집계에서 올바르게 가림**: `fixedHandTicks` 맵을 만들 때 `note.handSource === 'user' && note.hand !== 'R'`인 노트는 제외하도록 조건 추가 — 사용자가 하이햇을 'L'로 직접 지정했으면 그 틱의 'R'은 비어 있으므로, 같은 틱 크래시는 'R'을 그대로 유지한다(수정 전엔 하이햇이 여전히 'R'을 쥐고 있다고 잘못 보고 크래시까지 'L'로 밀어, 하이햇·크래시가 둘 다 'L'로 겹치는 새 충돌을 만들 수 있었음).
2. **단위 테스트 추가**: "사용자가 하이햇을 L로 지정해도 같은 틱 크래시가 R을 유지한다" 케이스(`sticking.test.ts`) — 지적된 시나리오를 그대로 재현해 회귀 방지.
3. `npx tsc -b`(exit 0), `npx vitest run`(134/134, 기존 133건 + 신규 1건) 재확인.
