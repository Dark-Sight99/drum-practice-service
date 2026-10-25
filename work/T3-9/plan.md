> 한 줄 요약: T3-9(REQ-04) 설계안 v3 — 재생 위치 탐색(±10초) + "여기서 시작/여기까지" 버튼으로 현재 위치를 A-B 루프 마디로 바로 지정. 1라운드 BLOCKING 2건(C-001 루프 즉시 반영, C-002 자동 정지 타이머 재계산) → §6·§7. 2라운드 BLOCKING(C-007: §7이 일시정지 중 seek에서도 무조건 실시간 타이머를 거는 바람에 일시정지 중인데도 자동 정지가 발동할 수 있었음) → §7을 pause-aware로 재설계. "오디오 타이밍·동기" 위험 작업 — 구현 전 Codex 모드C 검수 대상.

# T3-9 재생 위치 탐색 + 현재 위치로 A-B 구간 지정 — 설계 v3

## 모드C 2라운드 반영 내역
2라운드 BLOCKING 지적(C-007, 필수): §7의 `handleSeek()`가 일시정지 여부와 무관하게 항상 새 `setTimeout`을 건다 — 탐색 버튼은 일시정지 중에도 활성(§5)인데, 일시정지 중 seek하면 "일시정지 중엔 타이머가 실시간으로 안 흐른다"는 T3-6의 핵심 불변식을 깨고 타이머가 실시간으로 다시 돌기 시작해, 사용자가 그냥 멈춰서 보고 있는 동안에도 자동 정지가 발동할 수 있었음. §7을 `isPaused` 분기로 재설계 — 일시정지 중엔 `autoStopRemainingMsRef`만 새 값으로 갱신하고 `setTimeout`은 걸지 않음(T3-6의 `pauseAutoStopTimer()`가 이미 하는 "멈춰있을 땐 값만 저장" 패턴과 동일한 상태로 귀결 — 나중에 "▶ 재생"을 누르면 기존 `resumeAutoStopTimer()`가 이 갱신된 값을 그대로 집어서 정상적으로 타이머를 건다). C-001은 2라운드에서 해결로 판단됨, C-002는 이번 수정으로 완전 해소.

## 모드C 1라운드 반영 내역
1라운드 BLOCKING 지적 2건:
- **C-001(필수)**: 마킹 버튼은 재생 중 사용 가능하고 "여기까지"는 `loopEnabled`를 켜지만, 이건 React 상태만 바꿀 뿐 — `playDrumScore()`는 **재생 시작 시점**의 루프 구간으로 `transport.setLoopPoints()`/`transport.loop`를 1회 설정할 뿐, 재생 중 바뀐 `loopRef`를 이미 돌고 있는 Transport에 다시 적용하는 경로가 없었음. 그래서 재생 중 A-B 지점을 찍어도 **지금 재생에는 루프가 안 걸림**(다음에 정지 후 다시 재생해야 적용) — §6에서 "재생 중 루프 설정 즉시 반영" 경로를 새로 추가해 해소.
- **C-002(필수)**: 자동 정지 타이머(T3-6)는 재생 시작 때 산정한 전체 길이로 예약되고 일시정지·재개 때만 남은 시간을 재계산함 — seek은 이 타이머를 전혀 건드리지 않음. 뒤로 seek하면 곡이 실제로 끝나기 전에 타이머가 먼저 재생을 끊을 수 있고, 앞으로 seek하면 곡이 이미 끝난 뒤에도 타이머가 한참 남아있을 수 있음 → §7에서 seek 시 타이머를 재계산하도록 추가.
권장 사항(C-003~C-006)도 반영: §1에 "재발화가 모든 seek 상황에서 끊김 없는 재생을 보장하진 않는다"는 범위를 명확히 함(건너뛴 구간 노트는 안 울림, 이미 울리던 꼬리는 안 끊김 — 원래도 §가정·한계에 있었지만 QA 항목으로도 명시), §4에 `Number.isFinite` 방어 추가, §QA계획에 "루프 구간 밖으로 seek" 시나리오 추가. C-005(playFrom() 중 거부 처리)는 seek 전용 결함이 아니라 기존 재생 거부 처리의 한계라는 Codex 의견에 동의 — 추가 조치 없이 수용.

## 근거 REQ
REQ-04(2026-10-25 추가, 의뢰인 실사용 피드백): "A-B 루프 이거 마디수를 입력하는 방식으로는 활용 못하겠는데? 노래 듣다가 잘 안되는 부분이 있어서 거기 반복하려고 하는데 지금 듣고 있는 부분이 몇 번째 마디인지 어떻게 아는데 악보가 없으면."

명확화 후 확정된 방향(대화 로그):
- A-B 지정: 재생 중 "여기서 시작"/"여기까지" 버튼으로 **지금 재생 위치**를 집는 방식(의뢰인 선택).
- 단, 탭하려는 순간엔 이미 그 구간이 지나가버리는 문제가 있어 **재생 위치를 되돌릴 수 있어야 함**(의뢰인이 직접 지적) — "게이지바 드래그" 또는 "±10초 이동 버튼" 중 구현하기 쉬운 쪽 하나만(의뢰인이 선택 위임).

## 범위 경계
- **포함**: (1) "10초 뒤로"/"10초 앞으로" 버튼 — 재생 위치를 즉시 이동(게이지바 드래그보다 구현이 단순 — 드래그 제스처 처리·픽셀→시간 환산·클릭 오인식 방지가 필요 없음). (2) "여기서 시작"/"여기까지" 버튼 — 클릭 시점의 재생 위치를 가장 가까운 마디로 변환해 `loopStartBar1`/`loopEndBar1`에 반영.
- **제외**: 게이지바 드래그 탐색(의뢰인이 "구현하기 쉬운 쪽"을 명시적으로 위임 — ±10초 버튼 쪽이 더 단순해 그쪽을 채택, 드래그는 범위 밖). 10초 외의 다른 탐색 단위(예: 5초/30초) — 과한 옵션, 필요성 제기 없었음.

## 설계

### 1. Tone.js의 "즉시 위치 점프" 지원(실제 소스로 확인, 추측 아님)
설치된 Tone.js(15.1.22) 소스를 직접 읽어 확인:
- `node_modules/tone/build/esm/core/clock/Transport.js` 421~428행 — `Transport.seconds`는 getter/setter이고, 공식 JSDoc에 **"Setting the value will jump to that position right away."**라고 명시돼 있음. `set seconds(s)`는 내부적으로 `this.ticks = ticks`를 거쳐 틱 위치를 즉시 바꾼다.
- 같은 파일 449~467행 `set ticks(t)` — 재생 중(`state === "started"`)이면 `"stop"` 이벤트를 아주 가까운 미래 시각에 발행 → 틱 위치를 새 값으로 설정 → `"start"` 이벤트를 발행하는 "멈췄다 그 자리에서 다시 시작"하는 내부 동작. 재생 중이 아니면(정지·일시정지) 그냥 바로 틱 위치만 바꿈. 둘 다 즉시 점프를 지원.
- **핵심 — 왜 노트를 다시 스케줄링할 필요가 없는가**: `node_modules/tone/build/esm/core/clock/TransportEvent.js`의 `invoke(time)`(45~53행)을 보면, `this._once`가 `true`일 때만 발화 후 `this.transport.clear(this.id)`로 스스로를 제거한다. `Transport.js`의 `schedule()`(160~166행)이 만드는 `TransportEvent`는 `once` 옵션을 아예 안 넘기므로 기본값 `false`(`TransportEvent.js` 28~34행 `getDefaults()`)가 적용된다 — 즉 **`scorePlayer.ts`가 `transport.schedule()`로 예약한 노트·카운트인 이벤트는 한 번 울렸다고 타임라인에서 사라지지 않는다.** Transport의 내부 처리 루프(`Transport.js` 140~143행 `this._timeline.forEachAtTime(ticks, (event) => event.invoke(tickTime))`)는 "지금 틱"에 걸린 이벤트를 그때그때 부를 뿐이라, 뒤로 점프해서 같은 틱을 다시 지나가면 **자동으로 다시 발화한다** — 루프(A-B 반복) 경계에서 이벤트가 끊김 없이 재발화하는 것(work/T2-4/plan.md §설계)과 완전히 같은 메커니즘. 앞으로 점프(건너뛰기)하면 건너뛴 구간의 이벤트는 그 틱을 "지나가며" 호출되는 게 아니라 틱이 불연속으로 점프하므로 자연히 건너뛰어짐(의도된 동작 — 건너뛴 구간 노트가 한꺼번에 몰려 울리지 않음).
- 결론: **`transport.seconds = target`만으로 즉시 점프 + 이미 지난 구간으로 되감아도 노트가 다시 들리는 동작이 전부 공짜로 된다.** T3-6처럼 "원샷이 Transport와 독립적으로 계속 울릴 수 있다"는 문제는 여기선 해당 없음(점프는 pause와 달리 "지금 울리는 소리를 그대로 두고 틱만 얼리는" 게 아니라 틱 자체가 이동하는 것이라 다른 범주의 동작) — 다만 점프하는 "그 순간" 울리고 있던 소리(디케이 중인 크래시 등)는 자연스럽게 끊기지 않고 계속 울릴 수 있음(§가정·한계에 명시, 수용 가능한 수준으로 판단).
- **(모드C 1라운드 C-003 반영, 범위 명확화)** "재발화가 보장된다"는 건 **"그 틱에 걸린 `schedule()` 이벤트가 다시 호출된다"**는 뜻이지, 모든 seek 상황에서 완벽히 끊김 없는 재생을 보장한다는 뜻이 아니다 — 앞으로 건너뛴 구간의 노트는 (불연속 점프라 그 틱을 "지나가지" 않으므로) 원래 의도대로 안 울리고, 점프하는 순간 이미 울리고 있던 소리의 꼬리는 seek 자체로 끊기지 않는다(바로 위 문단과 같은 내용, QA 항목에도 명시 — 아래 §QA계획).

### 2. 분리 오디오 트랙 — 기존 `playFrom()` 재사용(새 메서드 불필요)
`trackPlayer.ts`의 `playFrom(songPositionSeconds, playbackRate)`는 이미 "주어진 위치로 이동 후 재생 시작"을 하는 함수(T3-3에서 루프 재진입에 쓰던 것과 정확히 같은 책임) — `.play()`를 다시 불러도 이미 재생 중인 엘리먼트엔 해가 없음(표준 동작). 점프 시 `tracks.playFrom(newPositionInTrackSeconds, playbackRate)`를 그대로 호출하면 끝 — 새 메서드 불필요.
- `newPositionInTrackSeconds`는 기존 `audioTrackPositionSeconds(audioStartSeconds, songStartSeconds, playbackRate)` 공식(work/T3-3/plan.md §4, 루프 유무와 무관한 일반식으로 이미 검증됨)을 그대로 재사용 — `audioStartSeconds`에 새 점프 목표 위치를 넣으면 됨.

### 3. `clock.ts`(MasterClock) — 메서드 1개 추가
```ts
export interface MasterClock {
  // ...기존 그대로...
  /** T3-9(REQ-04) — 재생 위치를 즉시 이 초 값으로 점프(Transport.seconds
   * setter, 공식 지원 — §1 참고). 재생 중이든 일시정지 중이든 호출 가능. */
  setPositionSeconds(seconds: number): void
}
```
구현: `setPositionSeconds(seconds) { transport.seconds = seconds }`. "교체 가능한 모듈" 원칙(intent/03-architecture-stack.md §1)대로, `PracticeCanvas.tsx`는 이 래퍼를 거쳐서만 호출하고 `Tone.getTransport()`를 직접 참조하지 않는다(기존 `getPositionSeconds()`와 같은 패턴).

### 4. `timing.ts` — 순수 함수 1개 추가
```ts
/** 재생 위치(초)가 속한 마디 번호(0-기준) — barIndexForTick의 "초 단위" 버전.
 * T3-9(REQ-04) — "지금 재생 위치"를 A-B 루프 마디로 바로 지정하는 데 씀.
 * 음수 결과(카운트인 구간 등 songStartSeconds 이전)는 0으로 클램프. */
export function barIndexForSeconds(
  positionSeconds: number,
  songStartSeconds: number,
  barSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(songStartSeconds)) return 0
  if (!Number.isFinite(barSeconds) || barSeconds <= 0) return 0
  return Math.max(0, Math.floor((positionSeconds - songStartSeconds) / barSeconds))
}
```
단위 테스트: 정확히 마디 경계일 때, 마디 중간일 때, `songStartSeconds` 이전(카운트인 중)일 때 0으로 클램프되는지, `barSeconds<=0` 방어, `NaN`/`Infinity` 입력 방어(모드C 1라운드 C-004 권장 반영 — 실제 호출부는 항상 유효한 값만 넘기지만 방어 비용이 저렴해 추가).

### 5. `PracticeCanvas.tsx` 연동

**±10초 탐색 버튼**:
```ts
function handleSeek(deltaSeconds: number) {
  if (!playbackRef.current) return // 재생 세션이 없으면 아무것도 안 함(정지 상태)
  const clock = getMasterClock()
  const current = clock.getPositionSeconds()
  const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpmRef.current)
  const songStartSeconds = barSeconds * COUNT_IN_BARS
  const songEndSeconds = songStartSeconds + barSeconds * totalBars
  const target = Math.min(songEndSeconds, Math.max(0, current + deltaSeconds))
  clock.setPositionSeconds(target)
  const tracks = playbackRef.current.tracks
  if (tracks) {
    const playbackRate = playbackBpmRef.current / score.meta.bpm
    const positionInTrackSeconds = audioTrackPositionSeconds(target, songStartSeconds, playbackRate)
    tracks.playFrom(positionInTrackSeconds, playbackRate)
  }
}
```
- 버튼: "◀◀ 10초" (`onClick={() => handleSeek(-10)}`), "10초 ▶▶" (`onClick={() => handleSeek(10)}`) — `disabled={!isPlaying && !isPaused}`(재생 세션이 있을 때만, 일시정지 중에도 가능 — §1에서 확인한 대로 Transport가 "started"가 아니어도 점프는 지원됨).
- 상한(`songEndSeconds`)·하한(0) 클램프로 카운트인 이전이나 곡 끝 이후로 못 넘어가게 막음.

**"여기서 시작"/"여기까지" 버튼**:
```ts
function markLoopPointFromCurrentPosition(which: 'start' | 'end') {
  if (!playbackRef.current) return
  const clock = getMasterClock()
  const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpmRef.current)
  const songStartSeconds = barSeconds * COUNT_IN_BARS
  const barIndex0 = barIndexForSeconds(clock.getPositionSeconds(), songStartSeconds, barSeconds)
  const bar1 = Math.min(totalBars, barIndex0 + 1) // 1-기준, totalBars로 클램프
  if (which === 'start') {
    setLoopStartBar1(bar1)
    if (bar1 >= loopEndBar1) setLoopEndBar1(Math.min(totalBars, bar1 + 1)) // 기존 blur 핸들러와 같은 규칙
  } else {
    setLoopEndBar1(bar1)
    if (bar1 <= loopStartBar1) setLoopStartBar1(Math.max(1, bar1 - 1))
    setLoopEnabled(true) // "여기까지"는 구간 지정을 완료하는 동작이라 바로 루프 켬(아래 "가정·한계" 참고)
  }
}
```
- 버튼: "⏱ 여기서 시작" / "⏱ 여기까지" — `disabled={!isPlaying && !isPaused}`(재생 세션 필요, 재생/일시정지 둘 다 허용).
- 기존 BPM/루프 입력의 "재생 중엔 잠금" 규칙(§기존 설계)과 달리, 이 두 버튼은 **재생 중에도 활성** — 애초에 "재생하면서 듣다가 누르는" 게 전체 기능의 목적이므로 잠그면 기능 자체가 성립 안 함. 숫자 입력칸(루프 시작/끝)은 기존 규칙 그대로 재생 중 잠금 유지 — 이 두 버튼은 "숫자칸에 값을 대신 채워주는" 경로일 뿐, 숫자칸 자체의 잠금 정책을 바꾸지 않음(버튼 클릭은 `setLoopStartBar1`/`setLoopEndBar1`을 직접 호출하므로 `disabled` 숫자칸과 무관하게 동작 — React state 변경 자체엔 DOM `disabled` 속성이 영향 없음).

### 6. [모드C 1라운드 C-001 반영] 재생 중 루프 설정을 실제로 돌고 있는 Transport에 즉시 반영

**문제**: `playDrumScore()`(`scorePlayer.ts`)는 `handlePlay()` 호출 시점에 딱 한 번 `transport.setLoopPoints(...)`·`transport.loop = true`를 건다. 이후 `loopEnabled`/`loopStartBar1`/`loopEndBar1`(React state)이 바뀌어도 — 기존 숫자 입력칸이든 이번에 추가하는 마킹 버튼이든 — 이미 돌고 있는 그 Transport 인스턴스엔 아무 영향이 없다. 숫자 입력칸은 재생 중 `disabled`라 지금까지 이 틈이 드러나지 않았을 뿐, 마킹 버튼은 **재생 중에도 활성**이라(§5) 이 틈이 바로 체감됨.

**근거(실제 설치된 소스로 확인)**: `Transport.js`의 틱 처리 루프(§1에서 인용한 `_bindClockEvents`/클럭 콜백 근처) — 루프 여부·경계 판정(`if (this._loop.get(tickTime)) { if (ticks >= this._loopEnd) {...} }`)은 매 틱마다 `this._loopStart`/`this._loopEnd`의 **그 순간 값**을 읽어 판정한다(한 번 캐시해두는 구조가 아님) — 즉 재생 도중 `transport.setLoopPoints()`/`transport.loop`를 다시 호출해도 다음 틱부터 바로 반영된다(Tone.js가 "재생 시작 전에만 설정 가능"으로 제한하지 않음).

**설계**: `clock.ts`(MasterClock)에 메서드 2개 추가(§3의 `setPositionSeconds`와 같은 자리):
```ts
export interface MasterClock {
  // ...
  setLoopPoints(startSeconds: number, endSeconds: number): void
  setLoopEnabled(enabled: boolean): void
}
```
구현: `setLoopPoints(s, e) { transport.setLoopPoints(s, e) }`, `setLoopEnabled(enabled) { transport.loop = enabled }`.

`PracticeCanvas.tsx`에 새 `useEffect` 추가(기존 "재생 중 믹서 상태가 바뀌면 즉시 반영" useEffect와 정확히 같은 패턴 — `playbackRef.current` 존재 여부로만 게이트):
```ts
useEffect(() => {
  if (!playbackRef.current) return // 세션 없으면 반영할 Transport 자체가 없음
  const clock = getMasterClock()
  if (!loopEnabled) {
    clock.setLoopEnabled(false)
    return
  }
  const barSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpmRef.current)
  const songStartSeconds = barSeconds * COUNT_IN_BARS
  // scorePlayer.ts/computePlaybackSchedule()과 똑같은 공식(loop.startBar는
  // 0-기준) — 두 곳이 서로 다른 공식을 쓰면 "처음 재생할 땐 맞는데 마킹
  // 버튼으로 바꾸면 살짝 어긋나는" 불일치가 생길 수 있어 반드시 일치시킴.
  clock.setLoopPoints(
    songStartSeconds + barSeconds * (loopStartBar1 - 1),
    songStartSeconds + barSeconds * loopEndBar1,
  )
  clock.setLoopEnabled(true)
}, [loopEnabled, loopStartBar1, loopEndBar1])
```
이 effect는 마킹 버튼이 state를 바꿀 때뿐 아니라, (이론상) 숫자 입력칸이 나중에 재생 중 잠금 해제되는 경우에도 똑같이 동작한다 — 일반화된 "루프 설정은 항상 살아있는 세션에 반영된다"는 불변식이 생기는 셈(부작용이 아니라 의도된 일반화).

### 7. [모드C 1·2라운드 반영] seek 시 자동 정지 타이머(T3-6) 재계산 — 일시정지 인지(pause-aware)

**문제(1라운드 C-002)**: T3-6에서 만든 자동 정지 타이머(`autoStopTimerIdRef`/`autoStopRemainingMsRef`/`autoStopScheduledAtRef`)는 "일시정지 중 흐른 시간"만 빼는 로직이라, seek으로 위치가 통째로 바뀌는 상황을 전혀 모른다. 뒤로 seek하면 곡이 실제로 다시 끝나기 전에 타이머가 먼저 발동해 조기 정지시킬 수 있고, 앞으로 seek하면 곡이 이미 끝난 뒤에도 타이머가 쓸데없이 한참 남아있을 수 있다.

**문제(2라운드 C-007)**: 1라운드 수정은 seek할 때마다 **무조건** 새 `setTimeout`을 걸었다. 그런데 탐색 버튼(§5)은 재생 중뿐 아니라 **일시정지 중에도 활성**이다 — 일시정지 중엔 "타이머가 실시간으로 안 흐른다"(T3-6의 핵심 불변식, `pauseAutoStopTimer()`가 값만 저장하고 `setTimeout`을 안 거는 이유)인데, 일시정지 중 seek하면 이 불변식을 깨고 타이머가 실시간으로 다시 돌기 시작해 — 사용자가 그냥 멈춰서 화면을 보고 있는 동안에도 자동 정지가 발동할 수 있었다.

**설계(v3)**: `handlePlay()`가 자동 정지 타이머를 최초로 걸 때 쓰는 "곡이 끝나는 절대 위치"(카운트인 + 마지막 노트 + 안전 여유, `countInSeconds + lastNoteSeconds + safetyMarginSeconds` — 기존 `totalMs/1000`과 같은 값, `clock.getPositionSeconds()`와 같은 좌표계) 계산을 공유 함수로 뽑아 seek 시에도 재사용한다:
```ts
function songEndPositionSeconds(): number {
  const countInSeconds = barDurationSeconds(score.meta.timeSignature, playbackBpmRef.current)
  const lastTick = Math.max(0, ...score.notes.map((n) => n.tick))
  const lastNoteSeconds = (lastTick / score.ppq) * (60 / playbackBpmRef.current)
  const safetyMarginSeconds = 4
  return countInSeconds + lastNoteSeconds + safetyMarginSeconds
}
```
`handlePlay()`의 기존 `totalMs` 계산을 `songEndPositionSeconds() * 1000`으로 교체(기존 로직과 동일한 값 — 공식을 한 곳으로 모아 §6과 같은 이유로 불일치 방지). `handleSeek()`은 점프 직후 이 값을 이용해 남은 시간을 다시 계산하되, **재생 중일 때만 실제로 타이머를 걸고, 일시정지 중이면 값만 갱신**(`pauseAutoStopTimer()`가 이미 남겨두는 "멈춰있을 때의 상태"와 정확히 같은 모양으로 귀결 — 나중에 "▶ 재생"을 누르면 기존 `resumeAutoStopTimer()`가 이 갱신된 값을 그대로 집어 정상적으로 타이머를 건다):
```ts
function handleSeek(deltaSeconds: number) {
  const session = playbackRef.current
  if (!session) return
  // ...기존 점프 로직(§5)...
  if (autoStopRemainingMsRef.current !== null) { // 루프 모드면 애초에 타이머가 없음(null) — 그대로 둠
    if (autoStopTimerIdRef.current !== null) clearTimeout(autoStopTimerIdRef.current)
    autoStopTimerIdRef.current = null
    const remainingMs = Math.max(0, (songEndPositionSeconds() - target) * 1000)
    autoStopRemainingMsRef.current = remainingMs
    if (isPaused) {
      // 모드C 2라운드 C-007 반영 — 일시정지 중엔 실시간으로 안 흐르므로
      // 여기서 타이머를 걸지 않는다(pauseAutoStopTimer()와 같은 "값만
      // 저장" 상태로 귀결). autoStopScheduledAtRef도 다음 재개 때
      // resumeAutoStopTimer()가 새로 채우므로 여기선 안 건드려도 됨.
    } else {
      autoStopScheduledAtRef.current = performance.now()
      const handle = session.handle
      autoStopTimerIdRef.current = setTimeout(() => {
        if (playbackRef.current?.handle === handle) stopPlayback()
      }, remainingMs)
    }
  }
}
```
기존 T3-6의 `handle` 아이덴티티 가드·`autoStopRemainingMsRef === null`(루프 모드 무시) 규칙·"일시정지 중엔 값만 저장" 불변식을 전부 그대로 재사용 — 새 메커니즘 없음.

## 위험 분류 — Codex 모드C 대상
- **오디오 타이밍·동기**: Transport 위치를 임의로 점프시키고(§1) 분리 오디오 트랙도 같은 위치로 맞춰야 함(§2). 재생 중인 Transport의 루프 설정을 실시간으로 갱신(§6)하고, T3-6 자동 정지 타이머도 seek에 맞춰 재계산(§7)해야 함. 특히 점프 직후 노트·오디오 트랙·레인 표시(이미 `getMasterClock().getPositionSeconds()` 기반으로 매 프레임 다시 그려지므로 추가 작업 불필요 — rAF 루프가 알아서 새 위치를 반영)·루프 경계·자동 정지 타이밍이 전부 같은 지점에서 다시 맞는지가 핵심 검증 대상.
- 새 공개 API·DB 스키마 변경 없음(순수 프런트 재생 위치 조작).

## QA 계획
1. 자동 테스트:
   - `timing.test.ts`에 `barIndexForSeconds` 추가 — 마디 경계·마디 중간·카운트인 구간(0 클램프)·`barSeconds<=0` 방어.
   - `clock.ts`는 기존부터 Tone.js 의존이라 jsdom 단위 테스트 범위 밖(파일 상단 기존 주석과 동일한 이유) — `setPositionSeconds` 자체는 테스트 안 함, 실제 브라우저 검증에 의존.
2. 실제 브라우저:
   - (a) 재생 중 "10초 뒤로" → 레인·킷 점등이 즉시 10초 전 위치로 이동하는지(화면으로 확인), 그 구간의 노트가 다시 들리는지(귀로 확인).
   - (b) "10초 앞으로" → 건너뛴 구간 노트가 안 들리고 새 위치부터 정상 재생되는지.
   - (c) 분리 오디오 트랙이 있는 곡에서 점프 후 신스 드럼(노트)과 원곡 오디오가 계속 맞는지(T3-3 리싱크 폴링이 몇백 ms 안에 교정하는지도 같이 확인).
   - (d) "여기서 시작"/"여기까지"를 재생 중에 눌러 A-B 루프 마디 숫자가 올바른 마디로 채워지는지, "여기까지"를 누르면 루프가 자동으로 켜지는지.
   - (e) 곡 시작 근처(카운트인 구간)에서 "10초 뒤로"를 눌러도 음수/비정상 위치로 안 가는지, 곡 끝 근처에서 "10초 앞으로"를 눌러도 범위를 안 넘는지.
   - (f) 일시정지 중에도 탐색·마킹 버튼이 동작하는지(§1에서 확인한 대로 Transport가 멈춰 있어도 점프는 지원).
   - (g) 점프 직후 직전에 울리던 디케이 긴 소리(크래시 등)가 어떻게 들리는지 확인(§가정·한계 — 끊기지 않고 계속 울릴 수 있음, 수용 가능한지 재확인).
   - (h) **(모드C 1라운드 C-001 회귀)** 재생 중 "여기서 시작"→"여기까지"로 A-B 구간을 지정하면, 정지·재시작 없이 **바로 그 구간을 반복**하는지 직접 들어서 확인(§6에서 고친 핵심 — 이게 안 되면 기능 전체가 무의미).
   - (i) **(모드C 1라운드 C-002 회귀)** 곡이 끝나갈 즈음 "10초 뒤로"를 눌러 뒤로 seek한 뒤, 곡이 실제로 다시 끝날 때까지 자동 정지가 조기 발동하지 않는지. 반대로 곡 끝 근처로 "10초 앞으로" seek했을 때 자동 정지가 비정상적으로 오래 안 걸리는지(남은 시간이 거의 0에 가깝게 재계산되는지).
   - (i-2) **(모드C 2라운드 C-007 회귀)** 일시정지한 채로 "10초 뒤로"/"여기서 시작" 등 탐색·마킹 버튼을 눌러도, 그 상태로 한참(예: 자동 정지 타이머가 걸렸을 법한 시간 이상) 가만히 놔뒀을 때 자동 정지가 발동하지 않는지(일시정지 중엔 타이머가 실시간으로 안 흘러야 함) — 그 뒤 "▶ 재생"을 누르면 seek으로 조정된 남은 시간 기준으로 정상적으로 타이머가 다시 걸리는지.
   - (j) **(모드C 1라운드 C-006 권장 반영)** A-B 루프가 켜진 채로 그 구간 밖으로 seek했을 때, Transport의 네이티브 루프가 다음에 `loopEnd`를 지날 때 정상적으로 루프 구간 안으로 되돌아오는지(의도된 "루프 밖에서 놀다가 자동으로 루프 안으로 복귀"가 이상하게 느껴지지 않는지 체감 확인).
3. 기존 회귀: A-B 루프 자체(기존 숫자 입력 경로)·BPM 변경·일시정지/재개(T3-6)가 이번 변경으로 깨지지 않는지 재확인.

## 가정·한계
- 점프하는 순간 울리고 있던 소리(디케이 중인 원샷)는 즉시 끊기지 않고 자연스럽게 계속 울릴 수 있음 — pause처럼 "지금 울리는 소리를 끊어야 한다"는 요구사항이 이 기능엔 없고(점프는 되감기/건너뛰기지 멈춤이 아님), 오히려 끊으면 어색할 수 있어 그대로 둠(채택 안 하는 쪽으로 판단, 반론 있으면 Mode C에서 재검토).
- "여기까지" 클릭 시 A-B 루프를 자동으로 켜는 것은 설계 판단(의뢰인이 명시적으로 요청한 건 아님) — 두 지점을 다 찍은 순간이 "이제 반복해줘"라는 의도로 해석. 의뢰인이 다르게 느끼면 쉽게 뺄 수 있는 부분.
- 게이지바 드래그는 범위 밖(§범위경계) — 나중에 필요하면 별도 작업으로.
