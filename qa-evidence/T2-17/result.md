> 한 줄 요약: Q-11 — 하이햇+크래시 동시타 우선순위를 의뢰인 확인대로 반전(크래시가 하이햇보다 우선, 하이햇이 L로 밀림). 순수 손 배정 로직 변경(타이밍/초 계산 영향 없음), FIXED_HAND_PRIORITY 배열 순서만 변경. 실제 곡(song id=2) 데이터의 진짜 동시타 2건(틱 4550/4550, 17270/17274)을 그대로 넣어 회귀 테스트로 검증, 138개 테스트 전부 통과.

# T2-17 크래시 vs 하이햇 우선순위 반전(Q-11)

## 배경
Phase 2 게이트 마지막 미결 항목. T2-11에서 "하이햇/라이드는 타임키핑 담당이라 손을 유지하고, 크래시는 액센트라 비켜주는 쪽이 자연스럽다"는 **검증 안 된 추측**으로 `하이햇_닫힘 > 하이햇_열림 > 라이드 > 크래시` 순서를 정했었음(Q-11에 "전문 검증 안 된 휴리스틱"으로 명시). 의뢰인이 실제 정석을 확인(2026-10-25, AskUserQuestion): **"하이햇과 크래시가 겹치면 하이햇은 항상 왼손으로. 크래시는 오른손으로 — 라이드(우측)에 있는 크래시를 치면 됨"** — 크래시가 물리적으로 라이드와 같은 오른쪽에 있어 오른손이 그대로 닿고, 하이햇은 왼쪽에 있어 왼손으로 넘기는 쪽이 자연스럽다는 것. 라이드 vs 크래시 우선순위는 의뢰인이 명시적으로 언급하지 않아 기존 순서(라이드가 높음)를 그대로 유지.

## 변경 범위
`app/web/src/score/sticking.ts`의 `FIXED_HAND_PRIORITY` 배열 순서만 변경:
```
변경 전: ['hihat_closed', 'hihat_open', 'ride', 'crash']
변경 후: ['ride', 'crash', 'hihat_closed', 'hihat_open']
```
로직(`hasHigherPriorityWithinTolerance` 등)은 이미 배열 순서(인덱스)만으로 판단하는 구조라 함수 코드 자체는 안 건드림 — 순수 데이터(우선순위 표) 변경. 틱→초/화면좌표 계산과 무관해 "위험 작업" 아님(T2-11/T2-12와 같은 기준), Codex 모드C 생략.

## QA 증거
- 테스트(`app/web/src/score/sticking.test.ts`): 기존 하이햇↔크래시 우선순위 검증 테스트 4개를 반전된 기대값으로 갱신(동일 틱 동시타, 허용폭 내 근접 틱, 사용자 수동지정 시 비간섭 케이스). 라이드 vs 크래시 테스트는 변경 없음(기존 순서 유지 확인용으로 그대로 둠).
- **실제 곡 데이터 회귀 테스트 추가**: 로그인된 브라우저 세션에서 `GET /songs/2/drumscore`(MusicDelta_Grunge, ppq=220)를 직접 호출해 하이햇·크래시가 허용폭 이내로 겹치는 실제 지점을 찾음 — 틱 4550/4550(정확히 같은 틱), 틱 17270/17274(4틱 차이). 이 두 실제 값을 그대로 새 테스트 케이스로 추가(`matches the real coincidence cases found in song id=2 after the T2-17 priority reversal`) — 둘 다 하이햇→L, 크래시→R로 배정됨을 확인.
- 전체 테스트: `npx vitest run` — 138개 전부 통과(`vitest_output.txt`, 신규 1건 포함 137→138).
- 린트: `npx oxlint` — 0건(`oxlint_output.txt`).
- 브라우저 수동 확인: 실제 Vite dev 서버에서 song id=2를 재생해 R/L 표시가 정상 렌더링되고 콘솔에 새 에러가 없음을 확인(스크린샷 다수). 다만 **정확히 그 동시타 틱(4550) 순간을 픽셀 단위로 캡처하는 건 못 함** — 연습 화면에 임의 시점으로 스크럽(탐색)하는 UI가 없어(재생/정지만 가능), 느린 BPM+A-B 루프로 여러 차례 시도했으나 정확한 프레임을 붙잡지 못함(한계를 숨기지 않고 명시). 대신 위의 **실제 데이터 그대로를 사용한 단위 테스트**가 더 결정적인 증거임 — 연습 화면은 이미 이 순수 함수의 결과를 그대로 그리기만 하는 구조(`PracticeCanvas.tsx`가 `recommendSticking()` 호출)라, 함수 단위에서 실제 값으로 검증되면 화면 결과도 동일하게 보장됨.

## 재현 방법
```
cd app/web
npx vitest run src/score/sticking.test.ts
npx oxlint
```
실제 동시타 지점을 다시 찾으려면(로그인 세션, 브라우저 콘솔):
```js
const res = await fetch('/api/songs/2/drumscore', {credentials: 'include'})
const score = await res.json()
const tol = score.ppq / 16
const hh = score.notes.filter(n => n.piece === 'hihat_closed' || n.piece === 'hihat_open').map(n => n.tick)
const crash = score.notes.filter(n => n.piece === 'crash').map(n => n.tick)
crash.flatMap(c => hh.filter(h => Math.abs(c - h) <= tol).map(h => ({c, h})))
```
