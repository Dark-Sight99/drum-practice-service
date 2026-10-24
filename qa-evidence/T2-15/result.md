> 한 줄 요약: 탐 레인 라벨 T1/T2 → HT/MT 변경(FT와 같은 "의미 기반 2글자 약어" 스타일로 통일) — 순수 표시 텍스트 변경, 로직/타이밍 영향 없음, 테스트 137개 전부 통과·브라우저 실측 확인.

# T2-15 탐 레인 라벨 이름 변경(T1/T2 → HT/MT)

## 배경
Phase 2 게이트 전략 논의 중 의뢰인이 지적(2026-10-25): "탐을 3종으로 늘려야 하는 이유는 실제 악보 기반 채보에서도 탐 2종으로 묶는 게 이상하기 때문. 그런데 FT가 사실상 'T3'인데 T1/T2라고만 쓰는 건 이름이 일관되지 않다"는 취지. 확인해보니 기존 레인 라벨 전체(HH/CR/SN/RD/KK)가 전부 "의미 기반 2글자 약어"인데, 탐만 T1/T2(숫자 번호) + FT(의미 약어)로 섞여 있었음. 의뢰인 확인(AskUserQuestion, 2026-10-25): T1→HT(하이탐)/T2→MT(미드탐)로 변경, FT는 유지 — 전체 레인이 HH/CR/SN/HT/MT/FT/RD/KK로 통일.

3번째 탐 샘플(진짜로 구분되는 소리) 확보는 별도 결정 — 의뢰인이 "나중 Phase로 미룸" 선택(Phase 3 하이브리드 입력 설계 시 같이 처리, Q-26 참조).

## 변경 범위
순수 레인 라벨(표시 텍스트) 변경. `DrumPiece` 타입(`tom_high`/`tom_mid`/`tom_floor`)·오디오 샘플 파일명·좌표 계산 로직은 변경 없음 — 화면에 보이는 2글자 약어만 교체.

- `app/web/src/render/layout.ts`: `LANES` 배열의 `tom_high`/`tom_mid` 레인 `label` 필드(T1→HT, T2→MT)
- `app/web/src/features/editor/grid.ts`: `EDITOR_ROWS`의 동일 필드
- `app/web/src/render/KitIllustration.tsx`: `KIT_PIECES`의 동일 필드 + 주석
- `intent/04-ui-ux.md` §3 와이어프레임, `intent/08-design.md` §3 레인 글자 표 — 문서 동기화

## 위험 분류
렌더링/라벨 표시 변경(문자열 리터럴 치환)이며 시간(초) 계산이나 재생 로직을 건드리지 않음 — T2-11/13과 같은 기준으로 "위험 작업" 아님, Codex 모드C(설계 검수) 생략, 모드A(코드 검수)만 진행.

## QA 증거
- 테스트: `npx vitest run` — 137개 전부 통과(`vitest_output.txt`). 라벨 문자열을 하드코딩해 검사하는 테스트 없음(사전 확인: `grep -rn "'T1'|'T2'" **/*.test.ts*` 결과 0건).
- 린트: `npx oxlint` — 경고/에러 0건(`oxlint_output.txt`).
- 브라우저 실측(실제 Vite dev 서버, http://localhost:5173):
  - 연습 화면 레인 머리글: 스크린샷으로 `HH CR SN HT MT FT RD KK` 확인.
  - 편집 화면 세로 행: 스크린샷으로 `HT`/`MT` 행 확인(HH(닫힘)/HH(열림)/CR/SN/HT/MT/FT/RD/KK 순).
  - 드럼킷 일러스트(SVG, 데스크톱 레이아웃에서만 렌더링 — `isPortraitPhone`일 때 숨김): `document.querySelectorAll('svg text')`로 텍스트 노드 직접 읽어 `["HH","CR","RD","SN","HT","MT","KK","FT"]` 확인.
  - 콘솔: 확인 당시 남아있던 에러 로그는 전부 이전 HMR 세션(오래된 `?t=` 타임스탬프)의 잔존 메시지로, 이번 변경 이후 새로 발생한 에러 없음(스크린샷 상 화면 정상 렌더링으로 교차 확인).

## 재현 방법
```
cd app/web
npx vitest run
npx oxlint
```
브라우저 확인은 `npm run dev` 후 로그인 → 라이브러리 → 곡 열기(레인 머리글)/편집(세로 행)/데스크톱 폭에서 연습 화면(킷 일러스트) 육안 확인.
