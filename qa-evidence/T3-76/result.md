> 한 줄 요약: 편집기 재생 중 노트 추가·선택·드래그·키보드 단축키·패널 버튼·다중선택 교대를 전부 잠금. Codex 모드A 3라운드(1차 REQUEST_CHANGES, 2차 REQUEST_CHANGES, 3차 APPROVE) 거쳐 구멍을 전부 막음.

# T3-76 QA 증거

## 배경
T3-75(재생 중 자동 스크롤)의 Codex 모드A 리뷰에서 "재생 중에도 노트 클릭 추가·드래그 이동이 막혀있지 않다"는 비차단 메모가 나왔고, 의뢰인이 "재생 중엔 편집 자체를 잠그자"고 결정.

## 구현(총 3라운드에 걸쳐 완성)
`app/web/src/features/editor/EditorScreen.tsx`:
1. **최초 구현**: `handleRowClick`(클릭으로 노트 추가) 맨 앞에 `if (isPlaying) return`, 노트 버튼에 `disabled={isPlaying}`(클릭 선택·드래그 시작 mousedown 둘 다 막음).
2. **Codex 모드A 1차 REQUEST_CHANGES(C-001)**: 재생 시작 전에 이미 선택돼 있던 노트는 그리드 버튼을 안 거치고도 (a) 화살표 키 이동·Delete/Backspace 삭제·숫자키 셈여림(`handleGridKeyDown`), (b) 선택 노트 정보 패널의 약/중/강·닫힘/열림·R/L/RF/LF·손지우기·삭제 버튼으로 여전히 수정 가능 — 둘 다 막음(`handleGridKeyDown` 맨 앞 `if (isPlaying) return`, 패널 버튼 전부 `disabled={isPlaying}` 추가, 하이햇 닫힘/열림의 기존 disabled 조건과는 `||`로 결합).
3. **Codex 모드A 2차 REQUEST_CHANGES**: (C-001) 다중 선택 패널의 "RLRL 교대"·"LRLR 교대" 버튼이 `applyAlternateHands`→`commit`으로 수정 가능한데 안 잠겨있었음 → `disabled={isPlaying}` 추가. (C-002) 드래그의 `mouseup` 리스너가 mousedown 시점 클로저로 `isPlaying`을 읽어, 드래그 도중(마우스 버튼을 누른 채) 재생이 시작되는 극단적 경우엔 커밋 시점에 과거(항상 false) 값을 보게 되는 이론적 구멍 → `isPlayingRef`(기존 `cursorTicksRef`/`stateRef`와 같은 ref 동기화 패턴) 신규 추가, `handleMouseUp`의 커밋 조건에 `!isPlayingRef.current` 추가.
4. **Codex 모드A 3차 APPROVE**: 위 전부 반영 확인, 추가 지적 없음.

## 테스트
- `npx tsc -b`: 에러 없음
- `npx oxlint`: 기존부터 있던 무관한 경고 4건만
- `npx vitest run`: **332 passed**(25 test files)

## 실브라우저 확인
song 9 편집기에서:
- 재생 중 빈 칸 클릭 → 노트 추가 안 됨(확인)
- 재생 중 기존 노트 클릭 → 선택 안 됨(확인)
- **재생 시작 전에 노트를 먼저 선택해둔 뒤 재생 → "삭제" 버튼이 `disabled: true`로 바뀌는 것을 직접 확인, 일시정지하면 다시 `disabled: false`로 돌아옴** (Codex 1차 지적이 실제로 막혔는지 가장 직접적인 검증)
- 일시정지 상태에서는 선택·추가·드래그 전부 기존처럼 정상 동작

## 결론
Codex 모드A 3라운드를 거쳐 재생 중 편집 가능한 경로를 전부(그리드 클릭/드래그, 키보드 단축키, 선택 노트 패널, 다중선택 패널, 드래그 커밋 시점 재확인) 막음 — "재생 중엔 편집 잠금"이 완전해짐.
