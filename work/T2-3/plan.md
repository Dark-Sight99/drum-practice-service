> 한 줄 요약: T2-3 — 연습 화면의 레인(노트 낙하)+드럼킷 점등+마디/박선 렌더러. Canvas 2D, 순수 좌표계산은 단위 테스트, 실제 그리기·fps는 jsdom이 Canvas를 지원 안 해 실제 브라우저로 검증.

# T2-3 계획

## 목표
`intent/05-todo.md` T2-3: "연습 화면 렌더러: 레인 + 킷 점등 + 마디선 (REQ-06)".

## 근거
REQ-06: 레인(노트 낙하)+하단 드럼킷 점등. 수용 기준: 60fps 목표(측정), 폰 세로·가로/태블릿/PC 레이아웃 동작, 스크린샷 증거. 상세 레이아웃·색·모양은 `intent/04-ui-ux.md` §3, `intent/08-design.md` §2,3(이미 `tokens.css`에 반영됨, T1-1).

## 범위 — 이번 작업이 다루는 것과 안 다루는 것
- **다룸**: 레인 노트 낙하(Canvas 2D), 판정선, 마디선·박선, 하단 드럼킷 점등(SVG), 반응형 레이아웃(폰 세로=레인만 / 그 외=레인+킷), fps 측정.
- **안 다룸**(다른 todo 항목): BPM 슬라이더·A-B 루프(T2-4), 라이브러리·업로드(T2-5), 스티킹 R/L 표시(T2-7 — `intent/04-ui-ux.md`가 레인/킷에 R/L도 언급하지만 `05-todo.md`가 T2-7로 명시적으로 분리해둠), 믹서 패널, 상단 바의 실제 버튼 동작(재생/정지는 데모용 최소 버튼만).
- 드럼킷 일러스트는 Q-09(자체 SVG, Phase 2 디자인 시 의뢰인 확인 필요 — 미해결)에 따라 **기능(점등 로직)만 구현**하고 비주얼은 단순한 도형(레인 노트와 같은 모양/색)으로 둠 — 정밀한 일러스트는 의뢰인 디자인 승인 후.

## 왜 jsdom에서 Canvas를 테스트할 수 없는지 (실제 실행으로 확인)
`document.createElement('canvas').getContext('2d')`가 jsdom에서 `null`을 반환함("Not implemented: ... without installing the canvas npm package" 경고와 함께) — T2-2의 Tone.js/Web Audio와 같은 사유. 그래서:
- **순수 좌표·시간 계산**(`layout.ts`: 노트의 Y좌표, 보이는 노트 필터링, 마디/박선 위치)은 Canvas 없이 단위 테스트.
- **실제 Canvas 그리기**(`laneRenderer.ts`)와 **fps 측정**은 실제 브라우저(Claude Browser pane)로 수동 QA + 스크린샷.

## 설계
- `app/web/src/render/layout.ts`(순수, 테스트됨):
  - `LANES`: 8개 레인 순서·피스·레인 글자·색(토큰 참조는 컴포넌트에서, 여기선 피스 목록만)·모양 메타데이터. `intent/04-ui-ux.md` §3 레인 순서(HH·CR·SN·T1·T2·FT·RD·KK), `08-design.md` §3 모양표 그대로.
  - `noteYPosition(noteTimeSeconds, currentTimeSeconds, pixelsPerSecond, hitLineY)`: 노트 시각→Y좌표(판정선 기준 위→아래 낙하).
  - `pixelsPerSecond(laneHeightPx, barsVisible, barDurationSeconds)`: "보이는 마디 수"(1~4, `04-ui-ux.md` "낙하 속도" 조절 가능 항목) 설정을 낙하 속도(px/s)로 환산.
  - `visibleNotes(notes, currentTimeSeconds, windowSeconds)`: 매 프레임 전체 노트를 다 안 보고 화면에 보이는 범위만 필터링(성능).
  - `barBeatLines(timeSignature, bpm, ppq, currentTimeSeconds, windowSeconds)`: 보이는 범위 안의 마디선·박선 시각 목록(마디선/박선 구분).
  - `activePieces(notes, currentTimeSeconds, hitWindowSeconds)`: 판정선 근처(±허용범위) 노트의 피스 집합 → 킷 점등 트리거.
- `app/web/src/render/laneRenderer.ts`(Canvas, 브라우저 전용): `createLaneRenderer(canvas, lanes)` → `render(score, currentTimeSeconds, barsVisible)` 매 프레임 호출. 레인 배경·마디선·박선·판정선·노트를 전부 그림.
- `app/web/src/render/KitIllustration.tsx`(SVG, React): 8피스를 `04-ui-ux.md`의 3행 배치(상단 HH·CR·RD / 중단 SN·T1·T2 / 하단 KK·FT)로 배치한 단순 도형. `activePieces` prop을 받아 해당 도형을 120ms간 밝게(§6 "약 120ms").
- `app/web/src/features/practice/PracticeCanvas.tsx`(React): `requestAnimationFrame` 루프로 `getMasterClock().getPositionSeconds()`를 매 프레임 읽어 `laneRenderer.render()`+`activePieces` 계산을 호출. 재생/정지 데모 버튼만(실제 BPM/루프 UI는 T2-4).
- 반응형: `04-ui-ux.md` "폰 세로 = 레인만(킷은 축소 아이콘), 그 외 = 레인+킷" — `window.matchMedia`로 세로·좁은 화면 판별(폭<높이 AND 폭 작음 기준은 실제 디바이스 확인 후 `qa-evidence/T2-3/result.md`에 구체 값 기록).

## 테스트 계획
1. `noteYPosition`: 노트 시각=현재 시각(판정선 도달)→Y=판정선, 미래 노트는 판정선보다 위(작은 Y), 과거 노트는 판정선보다 아래(이미 지나감)
2. `pixelsPerSecond`: 보이는 마디 수가 늘면 속도가 비례해서 빨라짐(같은 레인 높이에 더 많은 마디를 담아야 하므로)
3. `visibleNotes`: 창 밖 노트 제외, 창 경계값 포함/제외 일관성
4. `barBeatLines`: 4/4박자에서 마디당 마디선 1개+박선 3개(4박 중 첫 박은 마디선과 겹치므로 제외) 생성, 윈도우 경계 처리
5. `activePieces`: 판정선 허용범위 안 노트의 피스만 집합에 포함, 범위 밖 제외
6. 경계값: 노트 0개(빈 스코어), bpm/timeSignature 비정상값에도 크래시 없음
7. (수동 QA, 실제 브라우저) 레인+킷 렌더링 스크린샷(폰 세로/가로, 태블릿, PC 폭), fps 측정(단독 실행 — ⏱ `05-todo.md` 명시)

## 가정
- 드럼킷 일러스트는 정밀 그래픽이 아닌 placeholder 도형 — 의뢰인 디자인 승인은 Q-09로 이미 열려 있어 추가 등록 안 함.
- "보이는 마디 수" 기본값은 2마디로 임시 설정(조절 UI는 범위 밖, 추후 설정 화면에서 연결).
- 판정선 허용범위(킷 점등 트리거 윈도우)는 ±50ms로 임시 설정 — 정확한 "히트" 판정(채점) 자체는 이 프로젝트 범위에 없음(연습 보조 표시일 뿐), 구현 세부사항.
- fps 측정은 이 PC의 Chromium 기반 브라우저로만 수행 — 실제 저사양 폰 측정은 Q-01처럼 별도 실기기 확인 필요(이번엔 범위 밖, 발견되면 open-questions에 등록).
