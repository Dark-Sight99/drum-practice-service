> 한 줄 요약: 폰 가로모드(≤480px 높이)에서 레인 캔버스(최소 300px 고정)가 재생 버튼·레인 헤더를 시각적으로 덮어 클릭 불가였던 버그 수정 — 상단 UI 압축 + 레인 최소높이를 가로모드만 180px로 완화 + 블루투스 안내문 가로모드 생략. 테스트 전부 통과, 실브라우저로 폰 가로/세로/태블릿/PC 전부 확인, Codex 모드A 대기.

# T5-1 QA 증거 (Phase 5 — 반응형 레이아웃, REQ-06)

## 배경
"phase5 남은 작업들 진행해보자" 요청에 따라 반응형 레이아웃(REQ-06: 폰 세로/가로, 태블릿, PC)을 점검하던 중, 폰 가로(812×375 등) 연주 화면에서 재생 버튼과 레인 헤더(HH/CR/SN/...)가 스크린샷에 안 보이는 것을 발견. 처음엔 스크린샷 렌더링 문제로 의심했으나, `getBoundingClientRect()`+`document.elementFromPoint()`로 실측 확인한 결과 **진짜 버그**였음.

## 근본 원인
- `PracticeCanvas.tsx`의 레인 `<canvas>`는 "극단적으로 짧은 창에서도 레인이 안 쪼그라들게" `minHeight: 300`이 고정돼 있음(6차 의뢰인 요청, 기존 코드).
- 375px 높이 화면에서 레이아웃이 캔버스 행에 실제로 할당한 높이는 223px뿐(뒤로가기/제목/믹서버튼 등 다른 UI가 나머지를 먼저 차지).
- 캔버스가 강제로 300px로 그려지면서 아래 77px만큼 **재생 버튼이 있는 전송 컨트롤 줄을 시각적으로 덮음** — DOM엔 버튼이 정상 존재하고 클릭 핸들러도 붙어있지만(`display:flex, opacity:1, visibility:visible` 전부 정상), `document.elementFromPoint(버튼 중심좌표)`가 버튼이 아니라 `CANVAS`를 반환 — 클릭이 캔버스로 가로채여짐.
- 상단 UI(뒤로가기+제목 한 줄 압축, 믹서버튼 여백 축소)만으로 메울 수 있는 공간을 계산해보니, 레인(300 고정) + 필수 컨트롤 줄(50) + 시간표시(13) + 블루투스 안내(36) + 여백만 더해도 최소 415px가 필요한데 화면은 375px뿐 → **124px 부족**, 상단을 0까지 줄여도 수학적으로 메울 수 없음을 실측으로 확인(의뢰인에게 보고 후 방향 확정).

## 구현
의뢰인 승인 사항(①상단 압축 + 가로모드만 레인 최소높이 180px + 블루투스 안내 가로모드 생략):

- **`app/web/src/useCompactHeaderLayout.ts`**(신규) — `(max-height: 480px)` 미디어 쿼리 훅(기존 `PracticeCanvas.tsx`의 `useNarrowSettingsLayout`/`useStackedKitLayout`과 동일 패턴). 흔한 폰 가로 높이(360~430px대)는 걸리고 태블릿/PC(보통 600px+)는 안 걸리는 어림값.
- **`app/web/src/App.tsx`** — 연주 화면 `<main>`에서 `isCompactHeader`일 때: `padding` 16→8, 바깥 `gap` space-2→space-1, 뒤로가기 버튼+제목을 기존 두 줄(column)에서 한 줄(row)로 합침(제목은 `text-overflow:ellipsis`로 길면 말줄임).
- **`app/web/src/features/practice/PracticeCanvas.tsx`**:
  - `isCompactHeader`일 때 믹서버튼↔레인 사이 루트 `gap`, leftStack(루프상태줄↔레인행) `gap`을 space-4(16)→space-1(4)로 축소.
  - 레인 `<canvas>`의 `minHeight`를 `isCompactHeader ? 180 : 300`으로 — **세로/태블릿/PC는 기존 300 그대로**, 가로모드만 완화.
  - 블루투스 이어폰 안내 문구(`<p>`)를 `isCompactHeader`일 때 생략 — 세로/태블릿/PC는 그대로 상시 노출.
- **`app/web/src/test/setup.ts`** — jsdom이 기본 제공하지 않는 `window.matchMedia`를 표준 폴리필(`matches: false`)로 보강. `App.tsx`가 처음으로 matchMedia 기반 훅을 직접 호출하게 되면서(기존엔 테스트 대상이 아닌 `PracticeCanvas.tsx`에만 있었음) `App.test.tsx`(로그인 화면 등)가 렌더링 때마다 깨졌던 것을 수정.

## 테스트
- `npx tsc -b`: 에러 없음
- `npx oxlint`: 기존부터 있던 무관한 경고 4건만(Drawer.tsx 1건, PracticeCanvas.tsx 3건 — 이번 변경과 무관)
- `npx vitest run`: **333 passed**(25 test files) — 전부 통과(회귀 없음, matchMedia 폴리필로 App.test.tsx 2건 수정 포함)

## 실브라우저 확인 (Claude 내장 브라우저, song "Official髭男dism - Pretender")
- **폰 가로 812×375**(버그 재현 화면):
  - 수정 전: `document.elementFromPoint(재생버튼 중심)` → `CANVAS` 반환(가려짐), 스크린샷에도 재생 버튼·레인 헤더 행 안 보임.
  - 수정 후: `document.elementFromPoint(재생버튼 중심)` → 버튼 자신 반환(`topElementIsButtonOrChild: true`) 확인. 스크린샷으로 레인 헤더(HH CR SN KK HT MT FT RD)와 재생 버튼(⏪ ▶ ⏩ ↻ 쿠프시작) 전부 정상 노출 확인. 실제로 재생 버튼 클릭 → 아이콘이 ▶→⏸로 전환(재생 시작) 확인, 다시 클릭 → 정지 확인.
- **폰 세로 375×812**: 뒤로가기+제목 두 줄(기존 그대로), 레인 300px, 블루투스 안내문 그대로 노출 — 회귀 없음.
- **태블릿 768×1024**: 뒤로가기+제목 두 줄, 레인 300px, 블루투스 안내문 노출 — 회귀 없음.
- **PC(데스크톱 기본폭, 높이 744)**: 뒤로가기+제목 두 줄, 레인 300px, 블루투스 안내문 노출, 레인/킷 좌우 배치 — 회귀 없음.

## Codex 모드A
(진행 예정)

## 결론
폰 가로모드에서만(세로/태블릿/PC는 기존 그대로) 레인 최소높이를 180px로 낮추고 블루투스 안내문을 생략해, 수학적으로 불가능했던 "레인 300 고정 + 재생버튼 항상 보임"을 실제로 둘 다 만족하도록 수정. 의뢰인에게 중간 보고 후 방향(①→①+③ 조합)을 명시적으로 승인받고 진행함.
