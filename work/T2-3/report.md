> 한 줄 요약: 연습 화면 레인(노트 낙하)+드럼킷 점등+마디/박선 렌더러 구현. Canvas 2D, 순수 좌표계산은 단위 테스트, 실제 그리기·fps는 실제 브라우저로 검증 — 실측 60.1fps 달성, 실제 버그 2건(오디오 재생 예외, fps 저하 원인) 발견·수정. Codex 모드A 지적 C-001(정지 중 킷 점등 고정)도 수정·재검증 완료.

# T2-3 보고

## 변경 내용 (파일 → 근거)
| 파일 | 내용 | 근거 |
|---|---|---|
| `app/web/src/render/layout.ts` | 순수 좌표·시간 계산(노트 Y좌표, 낙하 속도, 보이는 노트 필터링, 마디/박선, 판정선 히트) | REQ-06, 단위 테스트 가능하게 분리 |
| `app/web/src/render/laneRenderer.ts` | Canvas 2D 레인 그리기(9종 노트 모양, 마디/박선, 판정선) | REQ-06, `intent/08-design.md` §3 모양표 |
| `app/web/src/render/KitIllustration.tsx` | SVG 드럼킷 점등(단순 도형 placeholder) | REQ-06, `intent/04-ui-ux.md` §3 배치 |
| `app/web/src/features/practice/PracticeCanvas.tsx` | rAF 루프로 마스터 클록 위치를 읽어 렌더러+킷 점등을 구동하는 데모 컴포넌트, 반응형 레이아웃 | REQ-06, T2-2 오디오 엔진 연동 |
| `app/web/src/audio/drumVoices.ts` | `createDrumVoices()`에 `await Tone.start()` 추가(버그 수정) | 아래 "구현 근거" 참고 |
| `app/web/src/render/layout.test.ts` | 테스트 15개 | `work/T2-3/plan.md` 테스트계획 |

## 범위 결정
`intent/05-todo.md`에서 BPM 슬라이더·A-B 루프는 T2-4, 라이브러리·업로드는 T2-5, 스티킹 R/L 표시는 T2-7로 이미 분리돼 있어, 이번엔 "레인+킷 점등+마디선" 렌더러 자체만: Canvas 2D 노트 낙하, 판정선, 마디/박선, SVG 킷 점등, 반응형(폰 세로=레인만/그 외=레인+킷), fps 측정. 드럼킷 일러스트는 `intent/07-open-questions.md` Q-09(의뢰인 디자인 승인 필요, 미해결)에 따라 정밀 그래픽이 아닌 placeholder 도형으로 기능만 구현. 상세 근거는 `work/T2-3/plan.md` §범위.

## 구현 근거 (실행 결과로 확인)
- jsdom에서 `document.createElement('canvas').getContext('2d')`가 `null`을 반환함(실제 실행으로 확인) — T2-2와 같은 사유로 순수 계산만 단위 테스트, Canvas 그리기·fps는 실제 브라우저 수동 QA.
- **실제 버그 1(재생 시 예외)**: `Uncaught Error: buffer is either not set or not loaded`가 Transport 예약 콜백에서 발생 — 디버깅 중 두 가지 잘못된 가설(메트로놈 선행 실행 문제, 단순 AudioContext 미시작)을 거친 끝에, (1) `createDrumVoices()`에 `await Tone.start()` 누락, (2) `PracticeCanvas`가 `playDrumScore()`의 `PlaybackHandle`을 추적 안 해 정지/언마운트 시 제대로 정리 못함 — 두 가지를 모두 수정. 완전히 새 브라우저 탭에서 전 구간(카운트인+9개 노트) 재생해 콘솔 에러 0건 재확인(`qa-evidence/T2-3/result.md`).
- **실제 버그 2(fps 30)**: `requestAnimationFrame` 180프레임 실측 결과 평균 33.3ms/프레임(≈30fps, REQ-06 목표 60fps 미달). 원인: 렌더 루프가 매 프레임 `setActivePieces(새 Set)`을 호출해 활성 피스가 안 바뀌는 프레임에도 React가 전체 리렌더. 직전 프레임과 내용이 같으면 `setState`를 스킵하도록 수정 — 재검증 결과 평균 16.6ms/프레임(**60.1fps**).
- `pixelsPerSecond`·`barBeatLines` 설계 오류 2건을 단위 테스트 작성 중(실행 결과로) 발견·정정 — `qa-evidence/T2-3/result.md` §발견한 설계 오류.

## 실행한 검증
`qa-evidence/T2-3/result.md`, `raw_log.txt` — tsc/oxlint/prettier/vitest(65/65) PASS. 실제 브라우저로 모양 확인, 재생 전체 구간 에러 0건, fps 실측(60.1), 반응형 스크린샷 3종(`screenshot-phone-portrait.jpg`, `screenshot-tablet.jpg`, `screenshot-pc.jpg`).

## 가정
- 드럼킷 일러스트는 단순 도형(Q-09 의뢰인 승인 대기).
- 폰 세로의 "킷 축소 아이콘"은 완전히 숨김으로 단순화.
- fps는 이 PC의 Chromium 브라우저로만 측정 — 실제 저사양 폰은 범위 밖(Q-01과 같은 결).
- 판정선 허용범위(±60ms), 보이는 마디 수(기본 2)는 구현 세부사항.

## 질문
- 없음.

## Codex 모드A 검수 반영
`qa-evidence/T2-3/codex-modeA.md` — 판정 REQUEST_CHANGES, 필수 수정 1건(C-001).

- **C-001(재현됨, 수정 완료)**: `PracticeCanvas.tsx`의 렌더 루프가 재생 여부와 무관하게 매 프레임 `activePieces`를 계산해, 정지 중에도(마스터 클록 위치가 고정된 상태) 그 위치 근처에 노트가 있으면 킷이 계속 켜진 채로 남아있을 수 있었음(예: tick=0 노트 + 클록 초기 위치 0초). `isPlayingRef`를 도입해 재생 중일 때만 점등을 반영하고, 정지 시 즉시 `activePieces`를 비우도록 수정. `isPlaying` 상태 전환은 (oxlint `react(set-state-in-effect)` 경고에 따라) `useEffect`가 아니라 `handlePlay()`/`stopPlayback()` 이벤트 핸들러 안에서 직접 수행.
- 재검증: 2노트(tick:0 kick, tick:PPQ*4 snare) 전용 하니스로 실제 브라우저에서 "재생 전 고정 점등 없음" + "재생 후 정지 시 즉시 소등" 둘 다 스크린샷으로 확인(`qa-evidence/T2-3/result.md` §Codex 모드A 검수 반영). 수정 후 tsc/oxlint/prettier/vitest 재실행 — 전부 클린, 65/65 통과.

## 남은 문제
- T2-4가 BPM 슬라이더·A-B 루프를 이 렌더러에 연결.
- T2-5(라이브러리)가 실제 곡 데이터를 `PracticeCanvas`에 공급.
- T2-7이 스티킹 R/L을 레인·킷에 추가로 표시.
- 드럼킷 일러스트 정밀화는 Q-09 의뢰인 디자인 승인 후.
- 실기기(저사양 폰) fps 측정은 Q-01처럼 추후 필요.
