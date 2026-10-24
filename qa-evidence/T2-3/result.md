> 한 줄 요약: T2-3 QA — tsc/oxlint/prettier/vitest 전부 통과(65/65: 기존 50개 + 신규 15개 순수 좌표계산 테스트). 실제 브라우저에서 레인+킷+마디선 렌더링 확인, 실측 fps 60.1(목표 달성), 반응형 3종 스크린샷, 실제 버그 2건 발견·수정. Codex 모드A 지적 C-001(정지 중 킷 점등 고정 유지)도 재현 확인 후 수정·재검증 완료.

# T2-3 QA 결과(2026-10-24)

## 실행 결과
| 항목 | 명령 | 결과 |
|---|---|---|
| 타입체크 | `npx tsc -b` | PASS |
| lint | `npx oxlint` | PASS |
| 포맷 | `npx prettier --check src/render src/features/practice src/audio/drumVoices.ts` | PASS |
| test(단위) | `npx vitest run` | PASS (65/65, T2-3 신규 15개 — `layout.ts` 순수 함수만) |
| test(수동, 브라우저) | Claude Browser pane에서 실제 렌더링·재생·fps 측정 | PASS(버그 2건 발견·수정 후) |

전체 로그: `raw_log.txt`

## 왜 Canvas 렌더링 로직은 단위 테스트가 없는가
`document.createElement('canvas').getContext('2d')`가 jsdom에서 `null`을 반환함("Not implemented: ... without installing the canvas npm package" 경고와 함께, 실제 실행으로 확인) — T2-2의 Tone.js/Web Audio와 같은 사유. 그래서 노트 좌표·마디선 위치 같은 **순수 계산**(`layout.ts`)만 분리해 단위 테스트했고, 실제 Canvas 그리기(`laneRenderer.ts`)와 fps는 **실제 브라우저**로 검증했다.

## 신규 단위 테스트(layout.ts, 15개)
| 테스트 | 확인하는 것 |
|---|---|
| `LANES` | 8레인이 9종 DrumPiece를 전부 커버(하이햇 닫힘/열림이 한 레인 공유) |
| `noteYPosition` | 노트 시각=현재 시각→판정선, 미래 노트는 위, 과거 노트는 아래 |
| `pixelsPerSecond` | 보이는 마디 수가 늘수록 낙하 속도가 비례해서 **느려짐**(처음엔 반대로 생각했다가 테스트 실패로 정정 — 아래 "발견한 설계 오류" 참고) |
| `visibleNotes` | 시간 창 밖 노트 제외, 창 안 노트 포함 |
| `barBeatLines` | 4/4 한 마디=마디선 1개+박선 3개, 반열림 구간이라 인접 창끼리 경계선 중복 없음 |
| `activePieces` | 판정선 허용범위 안 피스만 포함 |

## 발견한 설계 오류(테스트 작성 중 — 실행 결과로 바로잡음)
- `pixelsPerSecond`: 처음엔 "보이는 마디 수가 늘면 속도가 빨라진다"고 주석에 썼는데, 테스트를 실제로 돌려보니 반대(느려짐)였음 — 같은 레인 길이에 더 많은 마디를 담아야 하니 1초당 이동 거리가 줄어드는 게 맞음. 주석·테스트 둘 다 정정.
- `barBeatLines`: 처음엔 닫힌 구간([0,2])으로 설계해 1마디(0~2초)에 5개 선(마디선 2개 포함)이 나왔는데, 반열림 구간([0,2))으로 바꿔 다음 마디 시작과 중복되지 않게 수정(스크롤되는 다음 프레임 창과 이어붙일 때 경계선이 두 번 그려지는 걸 방지).

## 수동 QA(실제 브라우저) — 발견한 버그와 수정
Claude Browser pane에서 Vite dev 서버로 임시 하니스(QA 후 삭제)를 띄워 확인했다.

### 버그 1: 재생 시 "buffer is either not set or not loaded" 예외
디버깅에 여러 차례 잘못된 가설을 거쳤다(상세 경과는 `raw_log.txt`). 최종적으로 두 가지를 수정:
1. `drumVoices.ts`의 `createDrumVoices()`에 `await Tone.start()` 추가 — 브라우저 자동재생 정책상 사용자 제스처 응답 안에서 AudioContext를 깨워야 하는데 빠져 있었음.
2. `PracticeCanvas.tsx`가 `playDrumScore()`가 반환하는 `PlaybackHandle`을 그동안 버리고 있어서, 정지/재생/언마운트 시 Transport에 예약된 이벤트를 제대로 못 지우고 있었음 — `playbackRef`로 추적해 `handle.stop()`+`disposeDrumVoices()`를 항상 호출하도록 수정.

완전히 새 브라우저 탭에서 처음부터 끝까지(카운트인+9개 노트, 약 24초) 재생해 콘솔 에러 0건을 확인했다. (주의: 디버깅 중간에 "수정해도 똑같은 에러가 계속 보임"을 여러 번 겪었는데, 원인은 브라우저 콘솔 로그 조회 도구가 `navigate` 후에도 예전 로그를 계속 보여주는 특성 때문이었음 — 완전히 새 탭을 열고서야 "진짜 지금 상태"를 확인할 수 있었다. 이 경험을 교훈으로 남김: 수정 후 재검증은 반드시 새 탭/하드 리로드로.)

### 버그 2: fps가 30으로 측정됨(REQ-06 목표 60 미달)
`requestAnimationFrame` 180프레임의 실제 간격을 `performance.now()`로 측정 — 평균 33.3ms/프레임(≈30fps). 원인: 렌더 루프가 매 프레임 `setActivePieces(새 Set 객체)`를 호출해, 활성 피스가 안 바뀌는 대부분의 프레임에도 React가 `PracticeCanvas`+`KitIllustration`을 통째로 리렌더하고 있었음. 직전 프레임의 활성 피스 집합을 캐싱해 내용이 실제로 바뀔 때만 `setState`하도록 수정. 재검증(동일 조건): 평균 16.6ms/프레임(**≈60.1fps**), 최대 17.4ms, p95 16.9ms.

### 반응형 레이아웃 스크린샷(REQ-06 수용 기준)
- `screenshot-phone-portrait.jpg`(375×812, 세로): 레인만 표시 — `intent/04-ui-ux.md` §3 "폰 세로 = 레인만" 충족(단, "킷은 축소 아이콘"의 "축소 아이콘"은 구현 안 하고 완전히 숨김으로 단순화, `work/T2-3/plan.md` §가정).
- `screenshot-tablet.jpg`(768×1024): 레인+킷 둘 다 표시, 재생 중인 하이햇이 실제로 밝게 점등되는 것을 시각적으로 확인.
- `screenshot-pc.jpg`: 레인+킷 동일하게 표시.

## 수용 기준(REQ-06) 충족 여부
- [x] 레인(노트 낙하) + 하단 드럼킷 점등 — 구현·스크린샷 확인
- [x] 60fps 목표(측정) — 실측 60.1fps(버그 수정 후)
- [x] 폰 세로·가로/태블릿/PC 레이아웃 동작 — 스크린샷 3종 확인
- [x] 스크린샷 증거 — `screenshot-phone-portrait.jpg`, `screenshot-tablet.jpg`, `screenshot-pc.jpg`

## Codex 모드A 검수 반영 — C-001(재현됨, 수정 완료)
Codex 모드A(독립 코드 검수, `codex-modeA.md`)가 REQUEST_CHANGES로 지적:
> `PracticeCanvas.tsx:85-97` 재생 여부와 관계없이 매 프레임 `activePieces`를 계산하고, 활성 피스 상태를 유지합니다. 마스터 클록이 정지한 동안 현재 위치가 노트 시각에서 ±60ms 이내라면 해당 킷이 계속 켜져 있습니다.

**재현 확인**: tick=0 kick 노트가 있으면, 재생 전(마스터 클록 초기 위치=0초)에도 그 위치가 kick 노트의 ±60ms 판정 범위 안이라 처음부터 kick이 점등된 채로 보일 수 있는 로직이었음 — 코드 검토로 재현 가능함을 확인(실제 버그).

**수정**: `PracticeCanvas.tsx`에 `isPlayingRef`를 추가해 렌더 루프가 재생 중일 때만 `activePieces`를 반영하고, 정지 중엔 항상 빈 `Set`을 쓰도록 변경. `isPlaying`/`activePieces` 상태 전환은 `handlePlay()`/`stopPlayback()` 이벤트 핸들러 안에서 직접 수행(처음엔 `useEffect`로 구현했다가 oxlint `react(set-state-in-effect)` 경고를 받아 이벤트 핸들러 방식으로 수정).

**재검증(실제 브라우저)**: tick:0 kick + tick:PPQ*4 snare 2노트 스코어로 전용 하니스 구성 →
1. 재생 전 스크린샷: 모든 킷 서클이 흐린 상태(opacity 0.55)로, kick이 고정 점등되지 않음 확인.
2. 재생 → 6초 후 정지 버튼 클릭 → 스크린샷 재확인: 모든 킷 서클이 다시 흐린 상태로 복귀, 켜진 채 남은 피스 없음.

수정 후 `App.tsx`를 원래 최소 상태로 되돌리고 `tsc -b`/`oxlint`/`prettier --check`/`vitest run`을 재실행 — 전부 클린, 65/65 통과. 원자료(명령 출력 그대로): `reverify-20261024.txt`, `raw_log.txt` §4.

## Codex 모드B 검수 반영 — fps 원자료 부족(지적 확인, 보강 완료)
Codex 모드B(`codex-modeB.md`)가 REQUEST_CHANGES로 지적: report.md/result.md의 fps 60.1·테스트 65/65 수치가 `raw_log.txt`에 원자료(프레임 간격 측정값, 최신 명령 실행 로그) 없이 요약만 있어 대조 불가.

**확인**: 지적이 맞음 — 기존 fps 수치는 측정 당시 텍스트 요약만 기록했고, 65/65 테스트 결과도 C-001 수정 이전 실행 로그였음.

**보강**: (1) C-001 수정 후 `tsc -b`/`oxlint`/`prettier --check`/`vitest run`을 다시 실행해 실제 명령 출력을 `reverify-20261024.txt`에 그대로 저장(65/65 재확인). (2) fps를 Claude Browser pane에서 8마디 밀도 패턴(8분음표 하이햇 전체+마디당 킥/스네어)으로 재측정 — `requestAnimationFrame` 180프레임 간격 실측값을 `window.__fpsResult`에 기록 후 그대로 조회해 `raw_log.txt` §5에 원자료(JSON)로 보존: 평균 16.68ms(≈59.94fps), 최대 16.80ms, p95 16.80ms. 측정 중 콘솔 에러 0건(`read_console_messages`로 확인).

## 가정/한계
- 드럼킷 일러스트는 정밀 그래픽이 아닌 단순 도형(원+글자) — `intent/07-open-questions.md` Q-09(의뢰인 디자인 승인 필요)에 따라 이번엔 기능만.
- 폰 세로의 "킷 축소 아이콘"은 완전히 숨김으로 단순화(아이콘 디자인은 범위 밖).
- fps 측정은 이 PC의 Chromium 기반 브라우저로만 수행 — 실제 저사양 폰 측정은 Q-01처럼 별도 실기기 확인 필요(이번엔 범위 밖).
- 판정선 허용범위(±60ms)·보이는 마디 수(기본 2) 등은 구현 세부사항으로 임의 설정.
