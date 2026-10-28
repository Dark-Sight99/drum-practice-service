> 한 줄 요약: 일시정지 시 진행바(우측 세로 게이지)가 0%로 사라지던 버그 수정, 레인 아래에 곡 진행 분:초(경과/전체) 표시 추가.

# T3-49 결과

## 배경 (의뢰인 요청, 2026-10-28)
"곡 진행중에 일시정지했을 때 노트 떨어지는 레인 우측의 진행바가 갑자기
0%인거처럼 파란 게이지바가 사라지고 다시 시작하면 다시 생기는데 이것도
개선이 필요해보여. 일시정지해도 진행률 표시될 수 있게." / "노래 진행중인
분초를 나타낼 수 있으면 좋겠어."

## 원인 (진행바 버그)
`PracticeCanvas.tsx`의 rAF 루프가 진행률(`rawPercent`)을 `isPlayingRef.current`
(재생 중일 때만) 조건으로만 계산하고, 그 외엔 무조건 0으로 뒀다. 그런데
"재생 중이 아님"에는 서로 다른 두 상태가 섞여 있었다 — **정지**
(`Transport.stop()` → 위치가 0으로 리셋, `clock.ts`)와 **일시정지**
(`Transport.pause()` → 그 위치에 그대로 고정, 실제 설치된 Tone.js 공식
동작). 진행바 코드는 이 둘을 구분하지 않고 똑같이 "0%"로 그려버려서,
일시정지하면 (위치가 멈춰있을 뿐 그대로인데도) 게이지가 순간 사라지는
것처럼 보였다.

## 구현
- `app/web/src/features/practice/PracticeCanvas.tsx`
  - `isPausedRef`(useRef) 추가 — 기존 `isPlayingRef`와 같은 이유(rAF 루프는
    리렌더 없이 매 프레임 최신 상태를 읽어야 해서 state가 아니라 ref)로,
    `setIsPaused()`를 호출하는 4곳(`stopPlayback`, `handlePause`,
    `handlePlay`의 재개 분기 2곳) 모두에서 같이 동기화.
  - 진행바 계산 조건을 `isPlayingRef.current` → `isPlayingRef.current ||
    isPausedRef.current`로 확장. 일시정지 중엔 `positionSeconds`가 멈춘
    그 값을 그대로 유지하므로(`clock.ts` `getPositionSeconds()`가
    `transport.seconds`를 그대로 반환) 기존과 같은 공식을 그대로 써도 올바른
    값이 나온다 — 별도 "저장된 위치" 없이 조건만 넓히면 충분.
  - 곡 진행 분:초 표시 — `formatMmSs(seconds)` 헬퍼(모듈 스코프, 순수
    함수) 추가, `timeDisplayRef`(useRef)를 새로 만들어 기존
    `progressBarRef`와 같은 패턴(React state를 거치지 않고 rAF 루프가 매
    프레임 `textContent`를 직접 씀 — 매 프레임 setState 시 발생하는 리렌더/
    fps 저하를 피하기 위한 기존 설계 그대로 재사용)으로 "경과 / 전체"
    텍스트를 레인 바로 아래, 레인과 같은 폭으로 중앙 정렬해 표시.
  - 분:초 값은 진행바와 달리 **게이트 없이** 항상 `positionSeconds`에서
    계산(정지 땐 0초, 일시정지 땐 고정값이라 별도 분기 불필요) — 또한
    루프 중에도 "이 곡의 절대 위치"를 보여주는 게 맞다고 판단해(진행바는
    루프 중 "루프 구간 안에서"로 바뀌지만, 분:초는 곡 전체 기준 절대값을
    유지하는 쪽이 사용자에게 더 직관적) 루프 여부와 무관하게 동일한 공식
    사용. 전체 시간은 `barSeconds * totalBars`(기존 진행률 계산의 분모와
    동일 — BPM을 바꾸면 전체 재생 시간도 그만큼 줄거나 늘어나는 게 올바른
    동작이라 그대로 재사용).

## 테스트
- `npx tsc --noEmit` — 에러 없음.
- `npx oxlint` — 에러 없음(`Drawer.tsx`의 기존 `set-state-in-effect` 경고
  1건만 — 이전부터 의도된 패턴으로 문서화된 것, 이번 변경과 무관).
- `npx vitest run` — 275/275 통과(변경 없음, 이번 작업은 순수 UI/표시 로직).

## 브라우저 수동 QA (Claude 내장 브라우저, pretender 곡)
1. **재생 중** — 재생 버튼 클릭 후 5초 대기, 진행바 `style.height`가
   `3.45%`(0%가 아님)로 올라가는 것 확인, 분:초 텍스트가 `0:06 / 4:50`로
   올바르게 표시됨을 `textContent`로 확인.
2. **일시정지(버그 재현 → 수정 확인)** — 일시정지 클릭 직후 진행바
   `4.84%`, 분:초 `0:14 / 4:50`로 유지됨을 확인(수정 전이었다면 0%/
   `0:00`로 떨어졌을 상황). 3초 더 대기해도 두 값이 정확히 그대로
   유지됨을 재확인(위치가 실제로 고정돼 있음을 증명 — 흐르지도, 0으로
   떨어지지도 않음).
3. **정지(리셋)** — "처음으로 리셋" 클릭 후 진행바 `0%`, 분:초
   `0:00 / 4:50`로 정상 복귀 확인(정지와 일시정지가 서로 다르게 동작함을
   증명 — 정지만 0으로 리셋, 일시정지는 유지).

## Codex 모드A 검수
`task-mvs6v1p8-boyxu8` — 판정 **APPROVE**("No actionable issue found").
`isPausedRef`가 `setIsPaused`의 모든 전이 지점에서 일관되게 갱신됨,
`isPlayingRef`/`isPausedRef`가 둘 다 false인 경우는 정지·셋업 상태로
타당함, 진행률 계산이 루프·비루프 둘 다 고정된 Transport 위치를 올바르게
사용함, 분:초 표시도 같은 위치값을 읽고 곡 길이로 클램프됨,
`stopPlayback()`이 다음 애니메이션 프레임이 읽기 전에 Transport를 먼저
멈춤, `formatMmSs` 포맷터의 장시간 동작도 문서화된 범위와 일치함 — 확인.
(검수 프롬프트 전달 중 Bash 도구 환경 오류로 서브에이전트 경유 시도가
실패해, 직접 PowerShell로 `codex-companion.mjs task`를 호출해 우회함.)

## 남은 작업
- (완료) Codex 모드A APPROVE → `main` 병합.
