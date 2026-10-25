> 한 줄 요약: T3-10(연습 화면 UI 피드백 3건 — 레인 폭 고정, R/L 표시 제거, A-B 루프 버튼 재배치) QA 결과 — 타입체크/테스트/린트 통과, 넓은·좁은 화면 둘 다 브라우저로 확인.

# T3-10 QA 결과

## 근거(REQ)
- REQ-06 "드럼 연습 화면"(레인 폭 고정) — `intent/04-ui-ux.md` §3 "반응형" 보강.
- REQ-12 "스티킹(RL) 표시·편집"(연습 화면 표시 제거) — `intent/02-requirements.md` REQ-12 수정, `intent/08-design.md` §3 메모 추가.
- REQ-04 "구간 반복(A-B 루프)"(버튼 재배치) — 순수 레이아웃, 요구사항 문구 변경 없음.
- 의뢰인 메시지(2026-10-25, 스크린샷 첨부): "이렇게 좁게 써야 노트가 좀 잘보여서 화면을 넓게 키워서 쓰더라도 노트가 떨어지는 크기는 고정하고 그 외 여백에는 배경으로 채우고 싶은데 가능할까? 그리고 rl표시 이게 안맞는게 너무 많아서 그냥 없애는게 어떨까 싶어 ab루프도 여기서시작 여기까지 옆으로 옮기고"

## 변경 내용 (`app/web/src/features/practice/PracticeCanvas.tsx`만 수정)
1. **레인 폭 고정**: `<canvas>`에 `maxWidth: PRACTICE_LANE_MAX_WIDTH_PX`(520px, 신규 상수) + `margin: '0 auto'` + `display: 'block'` 추가. 좁은 화면(≤520px)에서는 기존처럼 꽉 채우고, 넓은 화면에서는 520px에서 더 안 넓어지고 중앙 정렬 — 좌우는 `<main>`의 배경색(`--bg`)이 그대로 보임. `laneRenderer.ts`는 매 프레임 `canvas.clientWidth`를 읽어 내부 해상도를 맞추므로 렌더러 쪽 변경 불필요(그대로 재사용).
2. **R/L 표시 제거**: `showSticking` state/ref/체크박스, `displayScore`(recommendSticking 기반 useMemo) 전부 삭제. 렌더 루프는 `score`를 직접 넘기고 `render()`의 `showSticking` 인자를 `false`로 고정, `KitIllustration`에도 `showSticking={false}` 고정 전달(이 prop은 이미 "꺼지면 항상 실선"을 지원하도록 설계돼 있어 — `KitIllustration.tsx` 기존 로직 그대로 재사용, 변경 없음). 판정선 근처 피스 점등(`activeHandByPiece`가 "어느 피스가 지금 활성인지" 판단하는 부분)은 손 정보와 무관하게 항상 동작하므로 영향 없음.
3. **A-B 루프 버튼 재배치**: "⟲ A-B 루프" 체크박스와 "⏱ 여기서 시작"/"⏱ 여기까지" 버튼을 하나의 flex 컨테이너로 묶음(기존엔 각각 별도 flex 아이템이라 좁은 화면에서 줄바꿈으로 서로 떨어질 수 있었음) — 항상 같은 줄/그룹으로 붙어 있게.

## 위험 분류
전부 "오디오 타이밍·동기"와 무관한 순수 UI(레이아웃·표시 끄기·버튼 그룹핑)이고, 재사용한 로직(`KitIllustration`의 `showSticking=false` 분기, `laneRenderer.ts`의 `canvas.clientWidth` 기반 해상도 계산)은 전부 기존에 이미 존재하던 코드 경로라 모드C 생략, 모드A만 진행(프로젝트 선례: T3-4-feedback-2/3, T3-8, T3-9-feedback-1과 동일 분류).

## intent/ 문서 갱신
- `intent/02-requirements.md` REQ-12 "표시" 항목 취소선 처리 + 사유 기록(편집기 쪽 "편집"·"자동 추천" 항목은 범위 밖이라 유지).
- `intent/04-ui-ux.md` §3 "스티킹(R/L)" 취소선 처리, "레인 폭 고정" 항목 신규 추가.
- `intent/08-design.md` §3 스티킹 항목에 연습 화면 표시 제거 메모 추가.

## 자동 테스트
```
cd app/web
npx tsc --noEmit        # 통과
npm test -- --run       # 17 test files / 195 tests 모두 통과(기존 로직 재사용·순수 UI라 신규 테스트 불필요 — PracticeCanvas.tsx 자체는 Canvas 2D 의존이라 jsdom에서 테스트 불가, 기존부터 브라우저 수동 QA 전용, work/T2-3/plan.md)
npm run lint             # oxlint 통과, 경고 없음
```

## 브라우저 수동 검증 (localhost:5174, huibigyocha 곡)
- **넓은 화면(1400×900 에뮬레이션)**: 레인 캔버스가 더 안 넓어지고 약 500px 폭으로 중앙 정렬됨(스크린샷 비율로 역산 확인), 좌우 여백은 페이지 배경색 그대로. 재생 시작 후 확대 캡처(zoom)로 떨어지는 노트 위에 R/L 글자가 전혀 없음을 직접 확인. 드럼킷 일러스트도 확대 캡처로 모든 피스 테두리가 점선 없이 실선만 있음을 확인(= `showSticking=false`가 `KitIllustration`에도 제대로 전달됨).
- **좁은 화면(400×800 에뮬레이션, 모바일 폭)**: 캔버스가 기존처럼 화면 폭을 꽉 채움(520px 미만이라 `maxWidth` 제약이 걸리지 않음 — 회귀 없음). "⟲ A-B 루프" 체크박스와 "⏱ 여기서 시작"/"⏱ 여기까지" 버튼이 한 줄에 붙어 있음을 확인. "R/L 표시" 체크박스는 더 이상 보이지 않음.
- 두 화면 모두 콘솔 에러 0건(`read_console_messages`).

## 결론
세 가지 요청(레인 폭 고정, R/L 표시 제거, A-B 루프 버튼 재배치) 전부 `PracticeCanvas.tsx` 한 파일 안의 순수 레이아웃·표시 변경으로 구현, 기존에 이미 검수된 렌더러·킷 일러스트 로직을 그대로 재사용해 새 버그 유입 가능성 낮음. 레인 고정 폭(520px)은 의뢰인이 보낸 스크린샷의 창 폭(약 500px)에서 역산한 추정치 — 실사용 중 너무 좁거나 넓으면 조정 필요.
