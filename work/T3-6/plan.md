> 한 줄 요약: T3-6(REQ-04) 설계안 v2 — "일시정지"(멈춘 지점부터 이어재생). 모드C 1라운드 BLOCKING 지적(이미 트리거된 원샷 드럼/메트로놈 소리가 Transport.pause()만으로는 안 멈춤) 반영 — `stopAllRinging()`을 신설해 일시정지 시 명시적으로 멈춘다. 나머지(Transport 네이티브 pause/분리 오디오 트랙)는 1라운드에서 이미 맞다고 확인된 부분 그대로.

# T3-6 일시정지/이어재생 — 설계 v2

## 모드C 1라운드 반영 내역(이 리비전에서 바뀐 것)
1라운드 BLOCKING 지적: 설계 v1의 §1("Transport.pause() 후 틱 위치가 그대로 보존된다")은 실제 소스로 맞게 확인됐지만, 거기서 "그러니 신스 드럼·메트로놈도 Transport가 멈추면 자동으로 같이 멈춘다"고 일반화한 건 **틀림** — 이미 `transport.schedule()` 콜백이 발화해 `new Tone.Player(buffer).start(절대시각)`으로 Web Audio 스케줄러에 커밋된 원샷(드럼 샘플)은 Transport의 틱-위치 동결과 **완전히 독립**이라, `transport.pause()`를 불러도 그 원샷은 원래 예정된 절대 시각에 계속 울린다(예: 크래시 심벌을 치는 순간 일시정지를 눌러도 크래시가 몇 초간 계속 울림). 이번 리비전은 §3을 다시 설계해 이 틈을 명시적으로 막는다. 나머지(§1 Transport 네이티브 pause, §2 분리 오디오 트랙)는 1라운드에서 지적 없었던 부분 그대로 유지.

## 근거 REQ
REQ-04(2026-10-25 추가, 의뢰인 요청): "일시정지/이어재생 — 멈춘 지점부터 다시 재생. 기존 '정지'(처음으로 되돌아가는 것)와는 별개 동작."

## 범위 경계
- **포함**: "⏸ 일시정지" 버튼 신설(재생 중에만 활성). 일시정지 중 "▶ 재생"을 누르면 멈춘 지점부터 재개. 기존 "⏹ 정지"는 그대로 "처음(카운트인 포함)으로 되돌아가며 완전히 멈춤" 동작 유지(의뢰인 요청에 명시된 대로 "정지와는 별개").
- **제외**: 일시정지 중 BPM/A-B 루프 변경(기존에도 재생 중엔 잠겨 있었음 — 일시정지도 "재생 세션이 살아있는 상태"로 취급해 계속 잠금, 과한 설계 방지). 일시정지 상태의 서버 저장(새로고침하면 처음부터 — REQ-05의 "곡별 마지막 설정 기억"은 믹서 볼륨/음소거/솔로에 한정된 것이지 재생 위치가 아님, 범위 밖). 일시정지 순간 울리고 있던 소리(크래시 디케이·메트로놈 클릭 테일 등)를 "멈춘 지점에서 이어서 계속 울리게" 하는 것 — §3에서 보듯 즉시 끊는 쪽을 택함(아래 "가정·한계"에 근거 명시).

## 설계

### 1. Tone.Transport의 네이티브 일시정지 지원(실제 소스로 확인, 추측 아님 — 모드C 1라운드에서 독립적으로 재확인됨)
설치된 Tone.js(15.1.22) 소스(`node_modules/tone/build/esm/core/clock/{Transport,Clock,TickSource}.js`)를 직접 읽어 확인:
- `Transport.pause(time)` → `Clock.pause(time)` → `TickSource.pause(time)` — 틱(위치)을 **리셋하지 않고** 상태만 `"paused"`로 바꿈.
- `TickSource.start(time, offset)`: `offset`이 **주어지지 않으면** 틱을 그대로 두고 그 위치에서부터 다시 흐르기 시작.
- `Clock.pause(time)`은 `this._state.getValueAtTime(computedTime) === "started"`일 때만 동작(`Clock.js` 122~132행) — **이미 멈춰있을 때 다시 호출해도 안전(멱등)**. 일시정지 버튼을 빠르게 두 번 누르는 등의 경쟁 상황에서 별도 가드 없이도 안전함을 보장.
- 결론: **`transport.pause()` 후 `transport.start()`(오프셋 없이)를 호출하면 멈춘 지점부터 정확히 재개된다** — 아직 발화하지 않은 `transport.schedule()`/`scheduleRepeat()` 이벤트(미래 노트·메트로놈 틱)는 Transport 자신의 틀 안에서 그대로 유효하므로 재스케줄링이 필요 없다. A-B 루프 설정도 Transport의 별개 속성이라 영향받지 않음.

### 2. 분리 오디오 트랙(`trackPlayer.ts`) — 새 메서드 2개 (1라운드에서 지적 없음, 유지)
```ts
pause(): void   // 언락된 트랙만 .pause()(HTMLMediaElement 네이티브 — currentTime은 그대로 보존됨, 스펙 보장)
resume(): void  // 언락된 트랙만 .play() 재호출(이미 한 번 제스처 안에서 성공적으로 재생된 엘리먼트는 이후 play()가 "블레스"된 상태로 유지되는 게 표준 동작)
```
- `resync()`는 수정 불필요 — 기존 가드(`track.element.paused`면 건너뜀)가 일시정지 중엔 자연히 아무것도 안 함.
- `playFrom()`/`stop()`도 수정 불필요.

### 3. [v2로 다시 설계] 이미 커밋된 원샷 소리를 일시정지 순간 명시적으로 끊기

**근거(실제 설치된 Tone.js 소스로 확인)**:
- `node_modules/tone/build/esm/source/buffer/Player.js` 169~172행 `_stop(time)`: `this._activeSources.forEach((source) => source.stop(computedTime))` — Player가 추적하는 내부 `ToneBufferSource`(실제 `AudioBufferSourceNode` 래퍼)를 전부 `.stop()`.
- `node_modules/tone/build/esm/source/Source.js` 179~198행 `stop(time)`: `this._state.getValueAtTime(computedTime) === "started" || isDefined(this._state.getNextState("started", computedTime))`일 때만 `_stop()` 실행 — **"지금 재생 중"이거나 "앞으로 재생 시작이 예정돼 있음" 둘 다 커버**. 즉 아직 실제로 소리가 나기 전(미래 시각으로 `.start()`만 걸어둔 상태)이어도 `.stop()`을 부르면 재생 시작 자체가 취소됨(Web Audio 표준 동작 — `AudioBufferSourceNode.stop()`이 예정된 시작 시각 이전에 불리면 그 소스는 아예 소리를 내지 않음).
- 즉 `player.stop()`은 "지금 울리고 있는 원샷"과 "Tone의 lookahead로 이미 커밋됐지만 아직 실제 시각이 안 된 원샷" 둘 다 안전하게 끊는다.
- `drumVoices.ts`의 기존 `activePlayers: Set<Tone.Player>` 추적(Codex 모드A C-002에서 이미 구축된 패턴)을 그대로 재사용 — `dispose()`가 쓰는 "스냅샷 떠서 순회 + onstop 선 분리" 기법과 동일하게, 새 `stopAllRinging()`은 `player.stop()`만 부르고(`dispose()`는 안 부름 — 샘플 버퍼는 살려둬야 다음 트리거에 또 씀) 실제 제거·dispose는 기존 `onstop` 핸들러(`activePlayers.delete(player); player.dispose()`)에 맡긴다(자연 종료 때와 완전히 같은 경로 — 이미 검증된 코드 경로 재사용, 새 위험 최소화).

```ts
// app/web/src/audio/drumVoices.ts — DrumVoice 인터페이스에 메서드 추가
export interface DrumVoice {
  trigger(time: number, velocity: number): void
  /** 지금 울리고 있거나(디케이 중) 아직 실제 시각이 안 된(lookahead로 이미
   * 커밋된) 원샷을 전부 즉시 끊는다. 샘플 버퍼는 유지 — dispose와 달리
   * 이후 trigger()를 계속 쓸 수 있음. T3-6 — Transport.pause()는 이미
   * 커밋된 원샷을 자동으로 멈추지 않으므로(위 "근거" 참고) 일시정지 시
   * 반드시 명시적으로 호출해야 함. */
  stopAllRinging(): void
  dispose(): void
}

// sampleVoice() 안, 기존 activePlayers Set을 그대로 재사용
stopAllRinging() {
  for (const player of Array.from(activePlayers)) {
    player.stop() // → onstop이 알아서 Set에서 빼고 dispose (기존 자연종료 경로 재사용)
  }
},
```
```ts
// 맵 전체에 대해 — 기존 disposeDrumVoices()와 같은 패턴
export function stopAllRinging(voices: DrumVoiceMap): void {
  for (const voice of Object.values(voices)) voice.stopAllRinging()
}
```

**메트로놈·카운트인 클릭도 같은 문제**: `metronome.ts`/`scorePlayer.ts`의 카운트인 클릭은 `Tone.MembraneSynth.triggerAttackRelease(note, '16n', time)`로 소리 내는데, 둘 다 기본 envelope(`node_modules/tone/build/esm/instrument/MembraneSynth.js` 36~42행: `release: 1.4`초)을 그대로 씀 — 이미 발화된 클릭은 최대 1.4초 테일이 Transport pause와 무관하게 남는다(원샷 드럼만큼 크진 않지만 무시할 크기가 아님, 실제 기본값 확인 전엔 "메트로놈은 짧아서 괜찮다"고 추측했을 뻔함). `Monophonic.triggerRelease(time)`(`Monophonic.js` 50~55행 JSDoc: "If no time is given, the release happens immediately")를 인자 없이 호출하면 지금 울리는 음을 즉시 release 단계로 넘겨 테일을 앞당겨 끊을 수 있음(완전 무음은 아니고 release 커브를 지금부터 다시 타는 것 — "가정·한계"에 근거 명시).
```ts
// app/web/src/audio/metronome.ts — Metronome 인터페이스에 메서드 추가
export interface Metronome {
  setEnabled(enabled: boolean): void
  setVolume(volumeDb: number): void
  /** T3-6 — 일시정지 시 호출. 지금 울리는 클릭을 즉시 release 단계로 넘겨
   * 테일을 앞당겨 끊는다(Monophonic.triggerRelease, 공식 JSDoc: "If no
   * time is given, the release happens immediately"). */
  stopRinging(): void
  dispose(): void
}
// 구현: stopRinging() { synth.triggerRelease() }
```
`scorePlayer.ts`의 `countInSynth`는 `playDrumScore()` 안에서 이미 클로저로 접근 가능하므로 새 인터페이스 없이 `PlaybackHandle.pause()`에서 바로 `countInSynth.triggerRelease()` 호출.

### `PlaybackHandle`(scorePlayer.ts) 최종 형태
```ts
export interface PlaybackHandle {
  stop(): void
  pause(): void
  resume(): void
}
```
```ts
pause() {
  transport.pause()
  stopAllRinging(voices)       // NEW — 이미 커밋된 신스 드럼 원샷 즉시 끊기
  countInSynth.triggerRelease() // NEW — 카운트인 클릭 테일 앞당겨 끊기(이미 끝났으면 무해)
  tracks?.pause()
},
resume() {
  transport.start() // 오프셋 없음 — §1에서 확인한 대로 멈춘 지점부터 재개
  tracks?.resume()
},
```
신스 드럼·카운트인의 **재개(resume) 쪽은 별도 코드 불필요** — 멈췄던 원샷은 그냥 끊긴 채로 두고, Transport가 다시 틱을 흘리면 아직 발화 안 된 미래 노트들이 원래 스케줄대로 다시 발화되는 것으로 충분(REQ-04 수용 기준은 "멈춘 지점부터 다시 재생"이지 "멈춘 순간 울리던 디케이 테일을 이어서 재생"이 아님 — 범위경계에 명시).

### 4. `PracticeCanvas.tsx` 연동
- 기존 `isPlaying`(boolean, "지금 실제로 재생 중")은 그대로 두고 **새 `isPaused`(boolean) 상태를 추가**(전체를 3상태 union으로 바꾸는 큰 리팩터 대신 최소 침습).
- **상태 배타성 불변식**: `isPlaying && isPaused`가 동시에 true인 경우는 절대 없어야 함(모드C 1라운드에서 예상된 지적에 선제 대응). 전이는 3가지뿐:
  - 재생 중(`isPlaying=true,isPaused=false`) → "⏸" 클릭 → `handle.pause()` + `metronome.stopRinging()` → 일시정지(`isPlaying=false,isPaused=true`)
  - 일시정지(`isPlaying=false,isPaused=true`) → "▶" 클릭 → `isPaused`분기로 `handle.resume()`만 호출(새 세션 생성 로직 전부 건너뜀) → 재생 중(`isPlaying=true,isPaused=false`)
  - 재생 중 또는 일시정지 → "⏹" 클릭 → `stopPlayback()`이 `isPlaying`·`isPaused` 둘 다 false로 리셋 → 정지(`isPlaying=false,isPaused=false`)
  - "⏸" 버튼은 `disabled={!isPlaying}`이라 일시정지 중이거나 정지 상태에선 애초에 눌리지 않음(재진입 불가). 혹시 레이스로 두 번 눌려도 `transport.pause()` 자체가 `Clock.js`에서 멱등이라(§1) 안전.
- "⏸ 일시정지" 버튼: `disabled={!isPlaying}`. `onClick`: `playbackRef.current?.handle.pause()`, `playbackRef.current?.metronome.stopRinging()`, `isPlayingRef.current = false`(킷 점등 가드), `setIsPlaying(false)`, `setIsPaused(true)`.
- "▶ 재생" 버튼: `disabled={isPlaying}`(일시정지 중엔 활성 유지). `onClick`(`handlePlay`) 맨 앞에서 분기: `isPaused`면 `playbackRef.current?.handle.resume(); isPlayingRef.current = true; setIsPlaying(true); setIsPaused(false)`로 끝. 아니면 기존 "처음부터 새 세션 만들기" 로직 그대로.
- "⏹ 정지" 버튼: `disabled={!isPlaying && !isPaused}`. `stopPlayback()`은 끝에서 `setIsPaused(false)`도 같이 리셋.
- BPM/A-B 루프 입력의 `disabled` 조건: 기존 `isPlaying` 대신 `isPlaying || isPaused`로 바꿔, 일시정지 중에도 계속 잠긴 채 유지(§범위경계).
- **자동 정지 타이머**: 기존 코드는 `handlePlay()` 시점에 `setTimeout(stopPlayback, totalMs)`로 "실제 시간이 totalMs만큼 지나면 자동 정지"를 건다 — 일시정지로 멈춰 있던 시간도 그대로 흘러가 버리므로, 곡이 실제로 끝나기 전에 타이머가 먼저 발동해 조기 정지시킬 위험이 있다. 수정: 타이머 ID와 "남은 시간"을 `useRef`로 들고 있다가, 일시정지 시 `clearTimeout`하고 그 시점까지 남은 ms를 계산해 저장, 재개 시 그 남은 ms로 새 타이머를 다시 건다(루프 모드는 애초에 이 타이머를 안 걸므로 영향 없음).

## 위험 분류 — Codex 모드C 대상
- **오디오 타이밍·동기**: Transport·분리 오디오 트랙·신스·메트로놈이 전부 같은 지점에서 멈추고 같은 지점에서 다시 맞아야 함. 1라운드 BLOCKING(이미 커밋된 원샷이 자동으로 안 멈춤)을 §3에서 `stopAllRinging()`/`stopRinging()`/`countInSynth.triggerRelease()`로 반영. 특히 §2의 "모바일에서 일시정지 후 재생이 다시 거부되지 않는다"는 가정과 §4의 자동 정지 타이머 재계산이 여전히 실측 검증 대상.
- 새 공개 API·DB 스키마 변경 없음(순수 프런트 재생 상태 기계).

## QA 계획
1. 자동 테스트:
   - `trackPlayer.test.ts`에 `pause()`/`resume()` 추가 — 언락된 트랙만 멈추는지/다시 play()하는지, 언락 실패 트랙은 둘 다 건너뛰는지.
   - `drumVoices.test.ts`에 `stopAllRinging()` 추가 — 트리거된 Player가 `stop()` 호출 후 `onstop`을 거쳐 정리되는지(jsdom 한계로 실제 오디오 재생 자체는 검증 불가, 기존 파일의 한계와 동일 — mock으로 메서드 호출 여부만 검증).
2. 실제 브라우저:
   - (a) 재생 중 일시정지 → 소리가 멈추는지 → 재생 → **멈춘 지점부터** 이어지는지(처음으로 안 돌아가는지) 직접 들어서 확인.
   - (b) **1라운드 지적의 핵심 회귀 테스트**: 크래시/라이드처럼 디케이가 긴 피스를 친 "직후"(소리가 아직 울리고 있을 때) 일시정지를 눌러, 소리가 Transport.pause()만으로 안 끊기고 계속 울리던 증상이 재현되지 않는지 직접 들어서 확인.
   - (c) 노트가 막 발화되려는 찰나(스케줄은 이미 커밋됐지만 아직 실제 소리는 안 난 순간) 일시정지를 눌러도 그 노트가 아예 안 들리는지 확인(가능하면 느린 템포로 재현).
   - (d) 일시정지 중 BPM/루프 입력이 잠겨 있는지.
   - (e) 일시정지 중 "정지"를 누르면 완전히 처음으로 돌아가는지.
   - (f) 곡 길이에 비해 충분히 길게 일시정지해뒀다가 재생해서 자동 정지 타이머가 조기 발동하지 않는지.
   - (g) 모바일(가능하면)에서 일시정지→재생이 거부 없이 되는지.
   - (h) 일시정지 버튼을 빠르게 연타해도 에러 없이 안전한지(§1 멱등성 근거).
3. 기존 회귀: A-B 루프·BPM 변경·재생 반복(T3-3/T3-4에서 이미 확인한 시나리오)이 이번 변경으로 깨지지 않는지 재확인.

## 가정·한계
- 일시정지 위치는 저장 안 됨(새로고침·곡 이탈 시 사라짐) — REQ-05 "곡별 마지막 설정 기억"과는 무관(범위경계에 명시).
- 일시정지 순간 울리고 있던 소리는 **이어서 재생되지 않고 끊긴다**(크래시 디케이 중간에 멈췄다가 재개해도 그 크래시가 다시 안 울림) — REQ-04 수용 기준("멈춘 지점부터 다시 재생")은 노트가 그 지점부터 다시 트리거되는 것을 요구하는 것이지, 끊긴 디케이 테일의 완벽한 재생이 아님. Tone.js의 `Source.sync()`(Transport의 start/pause 이벤트에 맞춰 소스를 자동으로 멈추고 "중간부터" 재개하는 내장 기능, `Source.js` 225~261행)를 쓰면 이론적으로 디케이 중간 재개까지 가능하지만, 이미 수 차례 모드C/모드A로 검증을 끝낸 기존 노트 스케줄링 경로(절대시각 `transport.schedule()` + 언싱크 `player.start(time)`) 전체를 바꿔야 해 위험 대비 이득이 작다고 판단(최소 침습 원칙) — 채택 안 함.
- 메트로놈·카운트인 클릭의 `triggerRelease()`는 "완전 무음"이 아니라 "release 커브를 지금부터 다시 타는 것"이라 아주 짧은 테일이 남을 수 있음(기본 release 1.4초 중 이미 지난 만큼을 뺀 나머지가 아니라, 그 시점부터 다시 1.4초짜리 release 곡선을 타므로 실제로는 더 빨리 0에 수렴하지만 완벽히 0ms는 아님) — 드럼 원샷(수 초간 또렷하게 들리는 크래시 등)과 달리 체감상 무시 가능한 수준으로 판단, 완전 무음화(`volume=-Infinity` 임시 설정 등)는 지퍼 노이즈 위험이 있어 채택 안 함.
- 모바일 "일시정지 후 재생이 다시 거부되지 않는다"는 가정은 일반적인 웹 플랫폼 동작에 근거하되, 실기기로 직접 재현 검증은 QA 단계에서.
