> 한 줄 요약: Codex 모드A(독립 코드 검수) — P1 1건 지적(A-B 루프 진행바가 카운트인 오프셋을 반영 안 함)했으나, 실제 실행으로 재현 시도한 결과 **반박됨**(false positive) — 코드는 변경 전부터 이미 `songStartSeconds`를 루프 경계 계산에 포함하고 있었고, 디버그 계측으로 실측한 결과 진행률이 정확히 맞아떨어짐을 확인. T2-4에서 Codex 지적을 검증 후 반박한 선례와 같은 패턴.

# T2-8 Codex 모드A 원문 (2026-10-24)

대상: `branch diff against main` (task/T2-8-sync-fix, 커밋 96a9a3e까지)

## Codex 출력 원문

```
# Codex Review

Target: branch diff against main

The new renderer timeline includes the count-in, but A–B loop progress still uses loop bounds that omit it, so displayed progress does not correspond to the active loop. The other reviewed changes did not reveal a definite additional defect.

Review comment:

- [P1] Add the count-in offset to loop progress bounds — app/web/src/features/practice/PracticeCanvas.tsx:178
  When playback uses an A–B loop, these bounds are still computed from the loop's bar positions without accounting for the count-in offset, while the renderer now positions notes at `songStartSeconds + tickTime`. As a result, the progress indicator runs before the loop begins and can reach or exceed 100% before the loop-end position; offset both loop bounds by the same `songStartSeconds` used for note rendering.
```

## 재현 시도 — 결과: 반박(지적이 틀림)

### 1단계: 코드 직접 대조
`git diff main..task/T2-8-sync-fix -- .../PracticeCanvas.tsx`로 실제 변경분만 확인 — 이번 커밋은 `barSeconds`/`songStartSeconds` 계산을 렌더러 호출 **앞**으로 옮기고 재사용하게 했을 뿐, 루프 경계 계산(`loopStartSeconds = songStartSeconds + barSeconds * activeLoop.startBar`, `loopEndSeconds = songStartSeconds + barSeconds * activeLoop.endBar`)은 **옮기기 전부터 이미 `songStartSeconds`를 포함**하고 있었다(T2-4부터 있던 로직, 이번에 손 안 댐). 즉 Codex의 "루프 경계가 카운트인을 반영 안 한다"는 전제 자체가 코드와 다르다 — diff에서 `const songStartSeconds = ...` 줄이 "삭제"로 표시된 걸 "그 값에 더는 접근할 수 없다"로 잘못 읽은 것으로 추정(실제로는 같은 함수 스코프 위쪽으로 옮겨져 그대로 재사용됨).

### 2단계: 실제 실행으로 수치 검증(코드 읽기만으로 끝내지 않음)
의심을 완전히 지우기 위해 `rawPercent` 계산 직후 `window.__t28debug`에 `{positionSeconds, loopStartSeconds, loopEndSeconds, rawPercent}`를 임시로 기록하는 디버그 코드를 추가하고, 실제 브라우저에서 A-B 루프(마디 1~4) 켜고 재생해 측정(javascript_tool 실행 결과 원문은 `qa-evidence/T2-8/modeA-debug-measurements.md`에 그대로 보존):
- 재생 직후(카운트인 중, positionSeconds≈2.06s): `rawPercent≈0.75%` → 화면 진행바 폭 `1%` — 카운트인이 막 끝난 시점에 거의 0%인 게 정확함(카운트인 중엔 음수라 `Math.max(0,...)`로 clamp돼 있다가 막 양수로 전환).
- 8초 경과 시점(positionSeconds≈5.79s, 루프 구간 [2,10) 안): `rawPercent≈47.36%` → 화면 진행바 폭 `47%` — `(5.79-2)/8*100=47.4%`와 정확히 일치.
- 최초 측정(HMR로 코드를 라이브 수정한 직후, 페이지 새로고침 없이)에서는 진행바가 `0%`에 멈춰 보였는데, 이는 **Vite HMR이 남긴 좀비 컴포넌트 인스턴스**(라이브 편집 중 모듈이 여러 번 리로드되며 생긴 과거 클로저) 때문이었음을 전체 새로고침 후 재측정으로 확인 — 실제 버그가 아니라 QA 도구상의 artifact였다.

### 결론
`loopStartSeconds`/`loopEndSeconds`는 카운트인 오프셋을 정확히 반영하고 있고, 진행바는 실측으로 정확함이 확인됐다. Codex의 P1 지적은 **재현 안 됨(false positive)** — 코드 수정 없이 기각. 디버그 계측 코드는 검증 후 제거(커밋에 포함 안 됨, `git diff`로 확인).

## 참고 — 이 프로젝트의 기존 패턴
T2-4에서도 Codex 모드B가 "0길이 루프" 버그를 지적했으나 전수 시뮬레이션으로 재현 안 됨을 확인해 반박하고 지적을 철회시킨 사례가 있음(`logs/2026-10-24-T2-4-codex.md`). 이번 건도 같은 원칙(Codex 지적을 맹목적으로 따르지 않고 실행으로 검증 후 판단)을 적용한 것.
