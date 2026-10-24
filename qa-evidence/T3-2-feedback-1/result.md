> 한 줄 요약: "보이는 마디 수" 조절 UI 신설(REQ-04, 기존 `layout.ts`에 이미 있던 `barsVisible` 파라미터를 화면 컨트롤로 연결) — 빠른 곡의 촘촘한 연타가 화면에서 뭉쳐 보이는 문제를 해결. 순수 렌더링 설정이라 위험 작업 아님, 실제 브라우저로 빽빽한 스네어 런이 개별 타격으로 또렷이 갈라지는 것까지 확인.

# T3-2 게이트 피드백 1차 — 보이는 마디 수 UI 신설

## 배경
의뢰인이 실제 음원(희비교차, 빠른 곡)으로 T3-2 채보 결과를 연습 화면에서 재생해보고 "스네어·하이햇을 한 박 안에 여러 번 쳐야 하는 구간에서 노트가 너무 붙어 있어 몇 번 쳐야 하는지 안 보인다"고 지적.

## 원인 분석
처음엔 BPM을 낮추면 해결될 거라 생각했으나, `layout.ts`의 `pixelsPerSecond(laneLengthPx, barsVisible, timeSignature, bpm)` 수식을 직접 풀어보면 **BPM이 완전히 상쇄**된다는 걸 확인:
```
pixel_gap = (tick_gap/ppq) × (60/bpm) × [laneLengthPx × bpm / (beatsPerBar × 60 × barsVisible)]
          = (tick_gap/ppq) × laneLengthPx / (beatsPerBar × barsVisible)   ← bpm 소거됨
```
즉 BPM 슬라이더는 노트가 떨어지는 "시간"만 늘릴 뿐, 노트 사이 "픽셀 간격"은 전혀 안 바꾼다 — 사용자에게 이 사실을 먼저 정정해 전달함. 실제로 간격을 조절하는 건 `barsVisible`(보이는 마디 수)인데, 이 파라미터는 `PracticeCanvas`의 prop으로 이미 존재했지만(기본값 2 고정) **화면에 조절 UI가 연결돼 있지 않았음** — T2-3 때부터 있던 설계상 빈틈.

## 변경
`app/web/src/features/practice/PracticeCanvas.tsx`:
- `barsVisible`을 prop(초기값)에서 받아 `useState`로 전환(`playbackBpm`과 같은 패턴).
- BPM 컨트롤 옆에 "보이는 마디 수" `<select>`(1~4) 추가.
- BPM/A-B 루프와 달리 **재생 중에도 바꿀 수 있게 둠** — Transport 스케줄에 영향 없는 순수 렌더링 파라미터라 잠글 이유가 없음(BPM/루프는 재생 시작 시점 값으로 이미 스케줄돼 있어 재생 중 변경이 즉시 반영 안 되는 것과 다름).

## 위험 분류
렌더링 파라미터 UI 노출일 뿐 시간(초) 계산·오디오 스케줄링 변경 없음 — T2-11/T2-13과 같은 기준으로 위험 작업 아님, Codex 모드C 생략.

## QA 증거
- `npx vitest run` — 138개 전부 통과(기존과 동일, 이 변경은 Canvas 렌더링이라 jsdom에서 테스트 불가 — T2-3/T2-4 때부터의 기존 한계와 동일. `pixelsPerSecond` 자체의 수식은 이미 `layout.test.ts`에서 단위 테스트돼 있음).
- `npx oxlint` — 0건.
- **실제 브라우저로 효과 확인**: 실제 음원("희비교차", song id=9, 빠른 템포의 스네어 연타 구간 포함)을 `보이는 마디 수=1`로 재생 — 연속된 스네어 타격들이 서로 겹치지 않고 개별 R/L 라벨이 달린 채로 또렷이 분리돼 보임을 스크린샷으로 확인(기본값 2에서는 뭉쳐 보였던 바로 그 구간).

## 재현
```
cd app/web
npx vitest run
npx oxlint
```
브라우저 확인: 연습 화면에서 "보이는 마디 수"를 1로 낮추고 빠른 곡을 재생 — 연타 구간의 노트 간격이 넓어짐을 육안 확인.
