> 한 줄 요약: 넓은 화면에서 노트 레인을 좌측, 드럼킷 그림을 우측에 나란히 배치하고 레인을 더 길게(400→600px) — 좁은 화면(핸드폰 등)은 기존처럼 킷이 레인 아래로.

# T3-48 결과

## 배경 (의뢰인 요청, 2026-10-28)
"지금 레인하고 드럼이 있잖아. 믹서영역빼고. 노트를 좌측에두고 드럼을 우측에
둘까? ... 좌측 우측으로 나누면 노트 떨어지는 레인을 좀 세로로 길이를 좀 더
길게 만들 수 있을 거 같은데" — 레인 길이를 늘릴 수 있다는 점(lookahead
시간 증가)이 핵심 이득이라고 설명하고, 좁은 화면(핸드폰 등)에서는 기존처럼
킷을 아래로 내리는 조건으로 제안 → 의뢰인 확인("물론 화면이 좁아지면...
지금처럼 드럼은 아래로 내리려해").

## 구현
- `app/web/src/features/practice/PracticeCanvas.tsx`
  - `useStackedKitLayout()` 훅 추가 — `(max-width: 1199px)` 기준(기존
    `useNarrowSettingsLayout`의 900px 사이드바/Drawer 분기와는 다른 축의
    질문이라 별도 훅). 사이드바(320) + 레인(420) + 킷(320) + 간격이 한 행에
    들어가는 최소 폭 기준 어림값(다른 브레이크포인트들과 같은 성격의
    추정치 — 실기기 QA로 재확인 예정, `intent/07-open-questions.md`에 기록
    권장).
  - 메인 영역(설정 패널 제외) 안에 "좌측 열(루프 상태 줄+레인·진행바+재생
    컨트롤+블루투스 안내)"을 하나의 flex-column으로 묶고, 그 열과 킷 그림을
    감싸는 행을 추가 — `isKitStacked`가 true면 `flexDirection: 'column'`
    (기존과 동일하게 위아래로), false면 `flexDirection: 'row',
    alignItems: 'center'`(레인 열 좌측·킷 우측, 킷은 레인 열 높이 안에서
    세로 중앙 정렬).
  - 킷 그림 wrapper — 좁은 화면(`isKitStacked`)에서는 기존처럼
    `margin: '0 auto'`로 가운데 정렬, 넓은 화면(좌우 배치)에서는 더 이상
    가운데 정렬이 아니라 `flexShrink: 0`만(고정폭 유지, 세로 중앙은 위
    행의 `alignItems: center`가 담당).
  - `<canvas>` 높이 — `isKitStacked ? 400 : 600`. 킷을 아래가 아니라
    옆으로 옮겨 생긴 세로 공간을 레인 자체를 더 길게(더 먼 미리보기) 만드는
    데 사용(의뢰인이 명시적으로 기대한 효과). `laneRenderer.ts`가 매 프레임
    `canvas.clientHeight`를 읽어 내부 해상도를 맞추므로(실제 코드 확인,
    `src/render/laneRenderer.ts:267-271`) 렌더러 쪽 변경 불필요 — CSS
    height만 바꾸면 다음 프레임에 자동 반영.
  - 레인 폭(`PRACTICE_LANE_MAX_WIDTH_PX`)·블루투스 안내 문구 `maxWidth`는
    그대로(이번 요청 범위 밖) — `margin: '0 auto'`가 이제 "레인 열" 안에서
    중앙 정렬하므로 레인 열 자체가 그 maxWidth와 거의 같은 폭이라 시각적
    변화 없음.

## 테스트
- `npx tsc --noEmit` — 에러 없음.
- `npx oxlint` — 에러 없음(`Drawer.tsx`의 기존 `set-state-in-effect` 경고
  1건만 — T3-47-feedback-1에서 이미 의도된 패턴으로 문서화된 것, 이번 변경과
  무관).
- `npx vitest run` — 275/275 통과(변경 없음, 이번 작업은 순수 레이아웃).

## 브라우저 수동 QA (Claude 내장 브라우저, pretender 곡)
1. **넓은 화면(1400px)** — 레인(캔버스) `getBoundingClientRect()`:
   `height: 600`(기존 400에서 증가 확인), `left: 500`. 킷 SVG:
   `left: 1084`(레인 오른쪽), `width/height: 300`(정사각 유지), `top: 325.8`로
   레인 열 안에서 세로 중앙 부근에 위치 — 좌우 배치 + 레인 확장 둘 다 스크린샷·
   좌표로 확인.
2. **중간 폭(1100px, 900~1199px 구간)** — 설정 사이드바는 여전히 넓은
   화면용(항상 펼침)이지만 킷은 레인 아래로 스택됨, 캔버스 `height: 400`
   (좌우 배치 임계값 밑이라 기존 높이 유지) — 두 브레이크포인트가 서로
   독립적으로 동작함을 확인.
3. **좁은 화면(375px, 모바일 프리셋)** — 기존과 동일하게 "믹서" 트리거
   버튼 + Drawer, 레인 아래 킷(소형), 레이아웃 회귀 없음을 스크린샷으로 확인.

## Codex 모드A 검수
`task-mvs6uk9b-iad1vn` — 판정 **APPROVE**("No actionable correctness issue
found"). 레인 렌더러가 매 프레임 `canvas.clientHeight`를 읽어 `hitLineY`·
초당 픽셀·미리보기를 다시 계산하므로 600px 캔버스에서도 stale 값이 없음,
FPS·BPM 오버레이 위치 정상, `KitIllustration` 컴포넌트 타입·props·이벤트
배선 그대로, 900~1199px 구간(사이드바+킷 스택 동시 적용)도 교정 문제
없음, `alignItems: center`도 오버플로·클리핑 없음 — 확인. (검수 프롬프트
전달 중 Bash 도구 환경 오류로 서브에이전트 경유 시도가 두 번 실패해, 직접
PowerShell로 `codex-companion.mjs task`를 호출해 우회함.)

## 남은 작업
- (완료) Codex 모드A APPROVE → `main` 병합.
