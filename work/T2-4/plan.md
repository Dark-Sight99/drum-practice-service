> 한 줄 요약: T2-4 — BPM 변경(원곡 50%~150%)과 A-B 구간 반복(마디 단위). Tone.js Transport의 `loop`/`loopStart`/`loopEnd`는 `schedule()`로 예약한 이벤트(드럼 노트·카운트인)와 `scheduleRepeat()` 이벤트(메트로놈) 둘 다 루프 경계에서 끊김·중복 없이 자동 재생되는 것을 실제 설치된 Tone.js 소스(Transport.js/TransportEvent.js/TransportRepeatEvent.js)로 확인 후 그대로 사용.

# T2-4 계획

## 목표
`intent/05-todo.md` T2-4: "BPM 변경·A-B 루프 (REQ-04)".

## 근거
`intent/02-requirements.md` REQ-04:
- 연습 BPM을 원곡 대비 50%~150% 범위로 설정(직접 입력 또는 %).
- MIDI·레인·메트로놈은 같은 BPM으로 동기화.
- 구간 반복(A-B 루프): 마디 단위 지정.
- 수용 기준: 루프 경계에서 끊김·중복 클릭 없음.

`intent/04-ui-ux.md` §3 상단 바: `곡명  BPM [96](원곡 120, 80%)  ▶ ⟲`, 하단 `마디 진행바 / A-B 루프 표시`.

## 범위 — 다룸/안 다룸
- **다룸**: BPM 슬라이더+직접 입력(원곡 대비 50~150%), A-B 루프(마디 번호 지정, 켜기/끄기), 마디 진행바(+루프 구간 표시), `scorePlayer`/`laneRenderer`가 연습 BPM으로 동기화되게 수정.
- **안 다룸**:
  - **"오디오 트랙은 음정 유지 상태로 속도 변경"**(REQ-04 2번째 불릿) — Phase 2엔 분리된 원곡 오디오 트랙이 아직 없음(Demucs 분리는 Phase 3 T3-1). `preservesPitch` 채택은 이미 결정됐지만(Q-04, `wiki/decisions.md`) 실제 오디오 엘리먼트가 생기는 T3-3에서 적용. 지금은 MIDI 드럼 소리만 있고 MIDI는 애초에 속도 변경해도 음정이 변하지 않음(신스/샘플 트리거 시각만 BPM에 따라 바뀜) — 적용 대상 자체가 없음.
  - 메트로놈 켜기/끄기·음량 UI — `04-ui-ux.md` §4 믹서 패널(메트로놈을 믹서 트랙 중 하나로 나열)에 속해 `05-todo.md` T3-4(믹서)로 분리돼 있음. `createMetronome`(T2-2에서 이미 구현)은 아직 UI에 연결 안 함 — 카운트인 클릭(scorePlayer 내부)만 계속 사용.
  - REQ-04 공식 수용 기준(±30ms 측정)은 Q-05 계획대로 분리 오디오 트랙(Phase 3)까지 보류.
  - 라이브러리 연동(T2-5), 편집기(T2-6), 스티킹(T2-7).

## 설계

### 1. `app/web/src/audio/timing.ts`(순수, 신규 추가)
- `ticksPerBar(timeSignature, ppq)`: 한 마디의 틱 수(`곡 전체 길이(마디 수)` 계산용).
- `computePlaybackSchedule(timeSignature, bpm, countInBars, loop?)`: BPM·카운트인·루프 설정을 실제 스케줄링에 필요한 절대 초(seconds) 값들로 변환하는 순수 함수.
  - 루프가 없으면: `playbackStartSeconds=0`(곡 맨 앞부터), `loopStartSeconds`/`loopEndSeconds=null`.
  - 루프가 있으면: 카운트인을 **곡 맨 앞이 아니라 루프 시작 바로 앞**에 배치해, 루프 밖 구간을 처음부터 재생하지 않고 곧장 루프 구간으로 진입(`playbackStartSeconds = loopStartSeconds - songStartSeconds`).
  - `songStartSeconds`(= 카운트인 길이, "마디 0" 절대 위치)는 루프 여부와 무관하게 항상 같음 — 노트는 항상 이 기준으로 스케줄되고, 루프가 있으면 transport가 애초에 그 구간까지만 왔다 갔다 해서 루프 밖 노트는 자연히 재생되지 않음.

### 2. `app/web/src/audio/scorePlayer.ts`
- `PlayDrumScoreOptions`에 `playbackBpm?: number`(기본 `score.meta.bpm`), `loop?: { startBar: number; endBar: number }`(0-기준, `[startBar, endBar)`) 추가.
- `transport.bpm.value`·카운트인 길이·노트 스케줄 시각 전부 `score.meta.bpm` 대신 `playbackBpm`으로 계산.
- `computePlaybackSchedule()` 결과로 `transport.start(undefined, playbackStartSeconds)`(정확히 그 위치부터 재생 시작), 루프가 있으면 `transport.setLoopPoints(loopStart, loopEnd); transport.loop = true`.
- `stop()`에서 `transport.loop = false`로 초기화(다음 재생에 이전 루프 상태가 남지 않게).

**Tone.js 루프 동작 근거(실제 설치된 버전 소스로 확인, `node_modules/tone/build/esm/core/clock/`)**:
- `Transport.js` `_processTick()`: 루프 중 `ticks >= loopEnd`가 되면 클록 틱을 `loopStart`로 되돌리고(`_clock.setTicksAtTime`), 그 다음 `this._timeline.forEachAtTime(ticks, ...)`로 그 틱 위치에 예약된 이벤트를 호출 — `transport.schedule()`로 예약한 이벤트(드럼 노트·카운트인 클릭)는 `once:true`가 아닌 한 호출 후에도 타임라인에서 제거되지 않음(`TransportEvent.invoke()`: `if (this._once) this.transport.clear(...)`만 조건부 제거) → 루프가 같은 틱 위치를 다시 지나갈 때 **자동으로 재발화**됨.
- `TransportRepeatEvent.js`(`scheduleRepeat()`용, 메트로놈이 씀): 생성자에서 `transport.on("loopStart", this._boundRestart)`로 루프 시작 이벤트를 직접 구독해, 루프가 돌 때마다 다음 이벤트들을 그 시점 기준으로 재계산·재스케줄 — 끊김·중복 없이 이어짐.
- `Timeline.forEachAtTime()`: 정확히 같은 틱 값(`EQ` 비교)에 예약된 이벤트만 호출하고 제거하지 않음 — 이미 지난 이벤트가 중복 호출되지 않음을 함께 확인.
- 결론: Transport 네이티브 `loop`/`loopStart`/`loopEnd`를 그대로 쓰면 REQ-04 수용 기준("루프 경계에서 끊김·중복 클릭 없음")을 라이브러리가 이미 보장 — 별도의 커스텀 루프 재스케줄링 로직을 만들 필요 없음.

### 3. `app/web/src/render/layout.ts`, `laneRenderer.ts`
- `pixelsPerSecond`·`barBeatLines`는 이미 `bpm`을 매개변수로 받음(T2-3) — 변경 없음.
- `laneRenderer.render(score, currentTimeSeconds, barsVisible, playbackBpm?)`: `playbackBpm` 선택 인자 추가(기본 `score.meta.bpm`), 내부에서 `score.meta.bpm` 대신 이 값으로 속도·노트 시각 계산 — 연습 BPM을 낮추면 노트가 실제로 더 느리게 떨어지는 것까지 레인 렌더러가 반영.

### 4. `app/web/src/features/practice/PracticeCanvas.tsx`
- BPM 상태(`playbackBpm`, 기본 `score.meta.bpm`) + 슬라이더(범위 `score.meta.bpm*0.5` ~ `score.meta.bpm*1.5`, 정수 bpm) + 숫자 입력 + "원곡 {bpm}, {percent}%" 표시.
- A-B 루프 상태(켜기/끄기 체크박스 + 마디 번호 A/B 입력, 1-기준 표시 → scorePlayer엔 0-기준으로 변환). `totalBars`(곡 마지막 노트 기준, `ticksPerBar` 사용)로 입력 범위 제한(`A < B <= totalBars`).
- 마디 진행바: rAF 루프에서 `clock.getPositionSeconds()`를 "곡 내 마디 위치"로 환산해 `0~100%` 바 + 루프 구간(A~B) 하이라이트 표시.
- `handlePlay()`가 `playbackBpm`·`loop` 상태를 `playDrumScore` 옵션으로 전달, rAF 루프의 `laneRenderer.render()` 호출에도 `playbackBpm` 전달.
- 재생 종료 타이머(기존 "마지막 노트+여유분 후 자동 정지")는 **루프가 켜져 있으면 비활성화**(루프 중엔 끝나지 않고 계속 반복돼야 함 — 사용자가 직접 정지).

## 테스트 계획
1. `ticksPerBar`: 4/4·6/8 등에서 마디당 틱 수가 박자표·ppq에 맞게 계산됨.
2. `computePlaybackSchedule`(루프 없음): `playbackStartSeconds=0`, `songStartSeconds`=카운트인 길이, loop 값들 `null`.
3. `computePlaybackSchedule`(루프 `startBar=0`): 루프 없음과 수치가 동일(카운트인 위치가 자연히 곡 맨 앞과 같아짐).
4. `computePlaybackSchedule`(루프 `startBar>0`): `playbackStartSeconds`가 0보다 큼, `loopStartSeconds`가 정확히 그 마디 절대 위치, `loopEndSeconds > loopStartSeconds`.
5. BPM 50%/150% 경계값에서 `computePlaybackSchedule`·`ticksToSeconds` 등 기존 순수 함수들이 정상 동작(크래시 없음, 극단값에도 시간이 양수).
6. (수동 QA, 실제 브라우저) BPM 슬라이더로 속도 변경 시 레인 낙하 속도·오디오 피치(MIDI라 원래 안 변함 확인)·메트로놈(카운트인 클릭)이 맞물려 동작하는지, A-B 루프 2바퀴 이상 재생해 경계에서 끊김·중복 클릭 없는지 콘솔 에러 포함 확인.

## 가정
- BPM 슬라이더는 정수 단위로 반올림(소수점 BPM 입력 불필요 — 드럼 연습 특성상 정수로 충분, 구현 세부사항).
- A-B 루프 마디 범위는 UI에서 1-기준으로 표시(사용자에게 "마디 1부터"가 자연스러움), 내부 계산은 0-기준.
- 마디 진행바는 Canvas가 아니라 일반 HTML(div 너비 %)로 구현 — 레인 렌더러(Canvas)와 분리해 간단하게 유지(구현 세부사항, UI 스펙은 "진행바 표시"만 요구, 구현 방식은 지정 안 함).
- 메트로놈 온/오프 UI는 범위 밖(§범위) — 카운트인 클릭은 기존처럼 항상 울림.
