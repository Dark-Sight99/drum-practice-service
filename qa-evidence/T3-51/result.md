> 한 줄 요약: 키보드 단축키 추가 — 스페이스바 재생/일시정지 토글, 좌/우 화살표 10초 되감기/빨리감기.

# T3-51 결과

## 배경 (의뢰인 요청, 2026-10-29)
"스페이스바 누르면 재생 일시정지 되게, 키보드 좌키누르면 10초이전 되게,
우키누르면 10초 이후 되게 해줘."

## 구현
- `app/web/src/features/practice/PracticeCanvas.tsx`
  - 새 `useEffect`로 `window`에 `keydown` 리스너 등록.
  - 스페이스바(`e.code==='Space'`) — 재생 중이면 `handlePause()`, 아니면
    재생 버튼의 기존 disabled 조건(`isStarting || audioTracksLoading`)과
    동일하게 가드한 뒤 `handlePlay()`. 기본 동작(페이지 스크롤) 방지를
    위해 `preventDefault()`.
  - 좌 화살표(`ArrowLeft`) — `handleSeek(-10)`, 우 화살표(`ArrowRight`)
    — `handleSeek(10)`. 둘 다 기존 ±10초 버튼과 완전히 같은 함수를
    그대로 호출 — `handleSeek()`는 재생 세션이 없으면 내부에서 조용히
    무시하므로 버튼의 disabled 조건과 자연히 일치.
  - 이벤트 타깃이 `<input>`/`<select>`/`<textarea>`/
    `contentEditable` 요소면 가로채지 않고 그대로 반환 — BPM·오디오
    지연 보정 숫자칸 등에 포커스가 있을 때 스페이스바로 공백을 못
    치거나 그 요소의 기본 동작과 충돌하는 걸 방지.
  - `useEffect`의 의존성 배열에 `handlePlay`/`handlePause`/`handleSeek`를
    포함(oxlint exhaustive-deps 경고 발생, 코드 주석으로 근거 명시) —
    이 함수들은 `useCallback` 없이 매 렌더 새로 만들어지는데,
    `handleSeek()`가 `playbackBpm` 등 state를 ref가 아니라 클로저로 직접
    읽어서 의존성에서 빼면 effect가 재구독을 안 해 키보드 단축키가 그
    state의 예전 값을 계속 참조하는 stale closure 버그가 생긴다 — 매
    렌더 리스너를 다시 거는 쪽(가벼운 연산)을 택함.

## 테스트
- `npx tsc --noEmit` — 에러 없음.
- `npx oxlint` — 에러 없음(`Drawer.tsx`의 기존 경고 1건 + 이번에 추가된
  exhaustive-deps 경고 3건, 전부 의도된 것으로 코드 주석에 근거 명시).
- `npx vitest run` — 275/275 통과(변경 없음, 순수 키보드 입력 로직).

## 브라우저 수동 QA (Claude 내장 브라우저, back number 곡)
1. **스페이스바 재생** — 제목(비-입력 요소)에 포커스를 둔 뒤 스페이스바
   → 분초 표시가 `0:00`에서 `0:03`으로 올라감(재생 시작) 확인.
2. **스페이스바 일시정지** — 다시 스페이스바 → 재생 버튼
   `aria-label`이 "재생"으로 바뀜(일시정지 상태) 확인.
3. **우 화살표(+10초)** — 일시정지 `0:05`에서 우 화살표 → `0:15`로
   정확히 +10초 확인.
4. **좌 화살표(-10초)** — `0:15`에서 좌 화살표 → `0:05`로 정확히
   -10초 확인.
5. **입력 요소 포커스 중 가드** — 오디오 지연 보정 숫자칸에 포커스를
   두고 스페이스바를 눌러도 재생이 시작되지 않고(재생 버튼
   `aria-label` 그대로 "재생") 분초도 `0:00` 그대로임을 확인(단축키가
   가로채지 않고 입력 요소의 기본 동작에 양보함).

## Codex 모드A 검수
`task-mvs9pa85-2jbjn3` — 판정 **APPROVE**("No actionable issue found").
`handleSeek`가 `playbackBpm`·`score`·`isPaused`를 컴포넌트 state에서
직접 읽으므로 effect 의존성 배열에 포함한 게 stale 값을 막는 올바른
선택임을 확인. 입력 요소 가드가 세 단축키 전부보다 먼저 실행됨 확인.
스페이스바의 `preventDefault()`가 재생 가드보다 먼저 실행되고, keydown의
기본 동작을 막는 것 자체가 버튼의 네이티브 활성화(스페이스 keyup 시
포커스된 버튼 클릭)도 함께 막아 버튼에 포커스가 있을 때 중복 토글이
안 생김을 확인(Claude 내장 브라우저로도 재생 버튼에 포커스를 직접 준
뒤 스페이스바 1회 입력 → 정확히 1번만 토글됨을 실측 확인 — 코드
분석과 실측 둘 다 일치). `handlePlay`/`handlePause`/`handleSeek` 자체는
무변경 확인.

## 남은 작업
- (완료) Codex 모드A APPROVE → `main` 병합.
