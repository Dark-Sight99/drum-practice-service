> 한 줄 요약: T3-6(REQ-04) 설계안 v4(모드C 3라운드 완료 — 마스터 최종 판단 포함) — "일시정지"(멈춘 지점부터 이어재생). 1라운드 BLOCKING(원샷 소리 자동 미정지) → stopAllRinging(). 2라운드 BLOCKING(상태 전이 근거 부족) → 타이머 시계 기준 명시. 3라운드 BLOCKING(C-001: 일시정지 핸들러가 세션 생존 여부 안 보고 무조건 isPaused=true) → playbackRef.current 유무로 가드해 코드로 직접 해소, 이게 파이프라인 최대 재검수 3회 — 4라운드 대신 마스터가 직접 판단해 반영·근거를 문서화.

# T3-6 일시정지/이어재생 — 설계 v4

## 모드C 1라운드 반영 내역
1라운드 BLOCKING 지적: 설계 v1의 §1("Transport.pause() 후 틱 위치가 그대로 보존된다")은 실제 소스로 맞게 확인됐지만, 거기서 "그러니 신스 드럼·메트로놈도 Transport가 멈추면 자동으로 같이 멈춘다"고 일반화한 건 **틀림** — 이미 `transport.schedule()` 콜백이 발화해 `new Tone.Player(buffer).start(절대시각)`으로 Web Audio 스케줄러에 커밋된 원샷(드럼 샘플)은 Transport의 틱-위치 동결과 **완전히 독립**이라, `transport.pause()`를 불러도 그 원샷은 원래 예정된 절대 시각에 계속 울린다(예: 크래시 심벌을 치는 순간 일시정지를 눌러도 크래시가 몇 초간 계속 울림). v2에서 §3을 다시 설계해 이 틈을 명시적으로 막음(`stopAllRinging()`/`stopRinging()`). §1 Transport 네이티브 pause, §2 분리 오디오 트랙은 1라운드에서 지적 없었던 부분 그대로 유지.

## 모드C 2라운드 반영 내역(이 리비전 v3에서 바뀐 것)
2라운드 REQUEST_CHANGES/BLOCKING 지적 — v2의 §3(이미 커밋된 원샷을 끊는 설계) 자체는 방향이 맞다고 확인됐지만, 두 가지가 필수 보완 대상으로 지적됨:
- **C-001(필수)**: "`isPlaying && isPaused`가 동시에 true가 안 된다"는 걸 전이 목록만 나열해서는 보장이 안 됨 — 특히 자동 정지 타이머가 `stopPlayback()`을 부르는 시점과 일시정지/재개 버튼 핸들러가 겹치는 경우, 전이의 원자성과 "지금 이 콜백이 여전히 유효한 세션을 가리키는지"를 계획에 명시해야 함.
- **C-002(필수)**: 자동 정지 타이머의 "일시정지 중 흐른 시간"을 뺄 때 **기준 시계가 뭔지**(실시간 Date.now()는 배경 탭 스로틀링 등으로 어긋날 수 있음), 재개 시 남은 ms 재계산 규칙, 루프 모드와의 상호작용, `stopPlayback()`/언마운트 시 타이머 정리 규칙이 전부 미정이었음.
아래 §4를 다시 써서 둘 다 구체적인 메커니즘(기준 시계·ref 구조·세션 식별)으로 명시했다. 권장/리스크 의견(C-003~C-007)도 전부 반영: §3에 `activePlayers` 등록이 `player.start()`보다 먼저 일어남을 코드 인용으로 명시(C-003), 메트로놈·카운트인 신스가 실제로 기본 release(1.4초)를 쓰는지 생성 코드를 직접 확인(C-004), Clock.pause() 멱등성 주장의 범위를 "이미 멈춘 상태에서 재호출"로 좁힘(C-005), `stopAllRinging()`의 onstop 비동기 정리 타이밍이 다음 트리거와 충돌 안 하는 이유를 명시(C-006), 자동 테스트가 mock 중심이라 브라우저 검증을 필수 통과 기준으로 명문화(C-007).

## 모드C 3라운드 반영 + 마스터 최종 판단(이 리비전 v4)
3라운드도 REQUEST_CHANGES/BLOCKING — `intent/06-pipeline.md` "재검수 최대 3회" 규칙에 따라 이번이 마지막 자동 재검수이고, 이후는 마스터가 직접 판단해 근거를 문서에 남긴다(T3-4 3라운드와 같은 절차).

- **C-001(필수, 반영함)**: "일시정지 핸들러가 `clearTimeout()`을 불러도 이미 큐에 들어간 자동 정지 콜백이 그 뒤에 실행될 수 있다"는 지적. 이 지적의 정확한 메커니즘(clearTimeout이 "이미 큐에 들어간" 타이머까지 못 막는지)은 JS 이벤트 루프 스펙상 의문이 있음 — `clearTimeout(id)`는 콜백이 **실행을 시작하기 전까지는** 항상 취소를 보장한다(WHATWG HTML "run steps after a timeout": 콜백 실행 직전 `active timers` 목록에 그 id가 여전히 있는지 확인 — `clearTimeout`으로 지워졌으면 그 시점에 중단). 즉 두 태스크(클릭 핸들러/타이머 콜백) 중 어느 쪽이 먼저 실행되든 "둘이 동시에 절반씩 실행"되는 경우는 없음(JS 단일 스레드). 다만 이 지적이 가리키는 **진짜 문제**는 따로 있었음 — v3의 "⏸" 버튼 핸들러가 `playbackRef.current`가 이미 `null`인지(= 세션이 다른 경로로 이미 완전히 끝났는지) 확인하지 않고 **무조건** `setIsPaused(true)`를 호출하도록 적혀 있었다는 점. 만약(이론상으로라도) 타이머 콜백 쪽이 먼저 실행돼 `stopPlayback()`으로 세션이 이미 완전히 끝난 뒤에 "⏸" 클릭이 처리되면, 실제로 일시정지시킬 게 아무것도 없는데도 UI만 "일시정지 중"(`isPaused=true`)으로 잘못 전환되는 유령 상태가 생길 수 있었음 — 이건 메커니즘에 대한 정확한 설명과 무관하게 그 자체로 실재하는 빈틈이라 **코드로 직접 막음**(아래 §4 수정, 새 동기화 장치 없이 기존 `playbackRef.current`를 "지금 살아있는 세션의 유일한 근거"로 그대로 재사용 — 세대 토큰을 새로 추가하자는 권고는 과했다고 판단, 최소 침습).
- **C-005(권장, 반박)**: "`disabled={!isPlaying}`인데 일시정지 중엔 `isPlaying=false`로 설정하니 버튼이 비활성화 안 된다"는 지적은 **틀림** — `isPlaying=false`일 때 `!isPlaying`은 `true`이므로 `disabled={true}`, 즉 정확히 비활성화된다(정지 상태·일시정지 상태 둘 다 `isPlaying=false`라 둘 다 "⏸" 버튼이 비활성화되는 게 의도된 동작이고, 코드도 그렇게 돼 있음). 2라운드 리포트가 스스로 "한글 콘솔 출력 인코딩이 깨져 세부 문구를 완전히 대조 못 했다"고 보고한 것과 같은 종류의 오독으로 보임 — `work/T2-4/plan.md`의 "모드B 지적 검증 후 반박" 선례와 같은 방식으로, 불리언 조건을 직접 대입해 반박하고 코드는 그대로 둠.
- 그 외 C-002~C-004, C-006, C-007은 Codex 스스로 "해결됨"으로 재확인(아래 §4·§3·QA계획에 이미 반영된 v3 내용 그대로 유지).

이 결정으로 설계는 종료하고 구현으로 넘어간다. 구현 중 추가로 발견되는 문제는 Codex 모드A(코드 기반 검수)에서 다시 걸러진다.

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
- `Clock.pause(time)`은 `this._state.getValueAtTime(computedTime) === "started"`일 때만 동작(`Clock.js` 122~132행) — **"지금 이미 paused/stopped 상태"에서 다시 `pause()`를 부르면 확실히 no-op**(멱등). 단, 이 보장의 범위는 딱 거기까지다 — "started 상태인데 아직 실제로 틱이 흐르지 않은(스케줄만 된) 경우"까지 "안전"으로 확대하면 안 됨(모드C 2라운드 C-005 지적 반영, 과장된 일반화 제거). §4에서 "⏸" 버튼은 `disabled={!isPlaying}`으로 애초에 재진입 자체를 막으므로, 이 멱등성은 "혹시 버튼이 풀리는 찰나에 레이스로 두 번 눌렸을 때" 수준의 보조 안전장치로만 의존한다.
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
- **(모드C 2라운드 C-003 반영)** "모든 currently-tracked Player를 멈춘다"가 성립하려면 `activePlayers`에 등록되는 시점이 `player.start()`를 부르기 **전**이어야 한다(안 그러면 start() 호출 도중 예외가 나거나, 등록 전에 stopAllRinging()이 끼어들면 추적이 빠진 Player가 생김). 기존 `trigger()` 코드(`app/web/src/audio/drumVoices.ts` 51~60행)를 그대로 다시 확인: `activePlayers.add(player)` → `player.onstop = ...` → `player.start(time)` 순서로, **등록이 start() 호출보다 먼저** 일어나고 그 사이엔 동기적인 속성 대입뿐이라 예외가 날 수 없다(이번 리비전에서 trigger() 자체는 안 건드림 — 순서가 이미 맞는 기존 코드를 재확인한 것).

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

**메트로놈·카운트인 클릭도 같은 문제**: `metronome.ts`/`scorePlayer.ts`의 카운트인 클릭은 `Tone.MembraneSynth.triggerAttackRelease(note, '16n', time)`로 소리 내는데, 둘 다 기본 envelope(`node_modules/tone/build/esm/instrument/MembraneSynth.js` 36~42행: `release: 1.4`초)을 그대로 씀 — 이미 발화된 클릭은 최대 1.4초 테일이 Transport pause와 무관하게 남는다(원샷 드럼만큼 크진 않지만 무시할 크기가 아님, 실제 기본값 확인 전엔 "메트로놈은 짧아서 괜찮다"고 추측했을 뻔함). **(모드C 2라운드 C-004 반영)** 이 기본값이 실제로 두 생성 코드에서도 안 덮어써지는지 직접 확인: `app/web/src/audio/metronome.ts`의 `new Tone.MembraneSynth({ volume: options.volumeDb ?? -6 })`과 `app/web/src/audio/scorePlayer.ts`의 `new Tone.MembraneSynth()`(count-in) 둘 다 `envelope`/`release`를 넘기지 않음 — `getDefaults()`의 `release: 1.4`가 그대로 적용됨을 생성 코드 자체로 확인(추측 아님). `Monophonic.triggerRelease(time)`(`Monophonic.js` 50~55행 JSDoc: "If no time is given, the release happens immediately")를 인자 없이 호출하면 지금 울리는 음을 즉시 release 단계로 넘겨 테일을 앞당겨 끊을 수 있음(완전 무음은 아니고 release 커브를 지금부터 다시 타는 것 — "가정·한계"에 근거 명시).
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

**(모드C 2라운드 C-006 반영)** `stopAllRinging()`이 부르는 `player.stop()`의 실제 정리(`activePlayers`에서 빼고 `dispose()`)는 `onstop` 콜백이 브라우저의 오디오 렌더링 스레드가 실제로 소스를 멈춘 뒤에야(비동기로) 일어난다 — 일시정지 직후 바로 재개해서 같은 피스(예: 스네어)를 다시 트리거하면, 방금 멈추라고 한 Player가 아직 `activePlayers`에 남아있는 채로 새 Player가 또 추가될 수 있다. 이게 문제가 안 되는 이유: `trigger()`는 호출될 때마다 **항상 새 `Tone.Player` 인스턴스**를 만들어 추가할 뿐, 기존 엔트리를 재사용하거나 덮어쓰지 않는다(이미 `activePlayers`가 Set인 이유 자체가 "여러 개가 동시에 겹쳐 울리는 걸 허용"하기 위함 — 파일 상단 주석에 이미 명시된 기존 설계). 즉 "멈추라고 한 지 얼마 안 된 Player"와 "방금 새로 튄 Player"가 잠깐 Set에 같이 들어있는 건 평소 디케이 겹침(예: 8분음표 하이햇 연타)과 똑같은 정상 상태이고, 먼저 멈춘 쪽은 조금 늦게 자기 자신만 Set에서 빠진다 — 새 Player를 건드리지 않는다. 다음 번 `stopAllRinging()`(또 다른 일시정지)이 그 사이에 불려도 `Array.from(activePlayers)`로 그 순간의 스냅샷을 뜨므로 이미 멈추는 중인 Player에 또 `.stop()`을 부르는 것뿐 — `Source.stop()`은 이미 "stopped" 예정인 상태에 다시 호출해도 가드(`getValueAtTime`/`getNextState` 체크)가 있어 안전(§1 인용과 같은 패턴).

### 4. `PracticeCanvas.tsx` 연동

기존 코드(`app/web/src/features/practice/PracticeCanvas.tsx`)를 다시 읽어 정확히 확인한 기준점:
- `playSessionIdRef`(473행)는 이미 "지금 이 비동기 셋업이 여전히 최신 세션인지" 확인하는 세대 번호로 존재(T3-4 모드A에서 도입). `stopPlayback()`(475~498행)이 맨 처음 이 번호를 올린다.
- 기존 자동 정지 타이머(598~601행)는 `setTimeout(() => { if (playbackRef.current?.handle === handle) stopPlayback() }, totalMs)` — 타이머 콜백 자신이 **클로저로 캡처한 `handle`과 그 시점의 살아있는 `playbackRef.current.handle`을 직접 비교**해서, 이미 `stopPlayback()`(정지 버튼이든 다른 자동 정지든)이 먼저 실행돼 `playbackRef.current`가 `null`이 됐거나 새 세션(다른 `handle`)으로 바뀌었으면 **스스로 아무것도 안 함**. 즉 "지금 이 콜백이 여전히 유효한 세션을 가리키는지"를 이미 handle 아이덴티티로 확인하는 가드가 기존 코드에 있다(새로 만들 필요 없음).

**(모드C 2라운드 C-001 반영) 전이 원자성**: `isPlaying`·`isPaused` 둘 다 React state라, 둘을 바꾸는 코드(버튼 onClick, 자동 정지 콜백)는 전부 **하나의 동기 함수 호출** 안에서 완결돼야 한다(중간에 `await`가 끼면 그 틈에 다른 핸들러가 끼어들 수 있음 — 바로 이게 T3-4 모드A가 `handlePlay()`의 비동기 셋업 구간에서 실제로 겪은 것과 같은 종류의 위험). JS는 단일 스레드라 "동시에 실행"되는 두 핸들러는 없고, 오직 "어느 매크로태스크가 먼저 큐에서 빠지느냐"의 순서만 있다 — 그래서 각 전이가 지켜야 할 규칙은 둘뿐:
1. **상태를 바꾸는 코드 블록 자체는 중간에 `await`를 두지 않는다**(동기적으로 끝까지 실행). `handlePlay()`는 비동기 함수지만, 맨 앞의 "`isPaused`면 재개만 하고 끝" 분기는 어떤 `await`보다도 먼저, 완전히 동기적으로 끝나야 한다(아래 코드).
2. **모든 콜백이 자기 행동 전에 "지금도 내가 다루는 세션이 맞는지"를 현재 살아있는 상태(ref)로 다시 확인한다** — 클로저로 캡처해둔 옛 상태가 아니라.

이 두 규칙으로 구체적 경쟁을 따라가 보면:
- *자동 정지가 먼저 발동 → 그 직후 사용자가 "▶"를 누른 경우*: 자동 정지의 `stopPlayback()`이 이미 동기적으로 `playbackRef.current=null`, `isPlaying=false`, (아래에서 추가하는) `isPaused=false`까지 전부 끝낸 뒤에야 다음 매크로태스크(사용자 클릭의 React 이벤트 핸들러)가 실행된다. 그 시점에 `isPaused`는 이미 `false`이므로 "▶" 핸들러는 (재개가 아니라) "처음부터 새 세션 시작" 분기를 탄다 — 틀린 재개가 섞여 들어갈 여지가 없다(다만 사용자 입장에선 "이어서 재생될 줄 알았는데 처음부터 시작됐다"고 느낄 수 있음 — 이건 자동 정지가 실제로 곡을 끝냈다는 뜻이므로 UX상 맞는 동작).
- *사용자가 "▶"(재개)를 누른 직후, 거의 동시에 자동 정지 타이머가 발동하는 경우*: "▶" 핸들러의 재개 분기(아래 코드)가 **동기적으로** `clearTimeout` 후 남은 ms로 새 타이머를 다시 걸고 `isPaused=false`까지 끝마치므로, 그 사이에 옛 타이머 콜백이 끼어들 틈이 없다(clearTimeout이 호출된 시점 이후로 그 타이머는 절대 발동 안 함 — 브라우저 타이머 API의 기본 보장). 혹시 "클릭 이벤트"와 "이미 큐에 들어와 있던 옛 타이머 콜백"이 둘 다 대기 중이었다면, 둘 중 어느 게 먼저 실행되든 각자 끝에 가서 `playbackRef.current?.handle === handle` 가드(옛 타이머) 또는 현재 `isPaused` 값(재개 핸들러)을 확인하므로 결과가 꼬이지 않는다.
- 결론: 새 동기화 프리미티브(락 등)는 필요 없음 — 기존 `playbackRef.current.handle` 아이덴티티 가드 + "상태 전이는 항상 동기적으로 완결" 두 가지만 지키면 `isPlaying && isPaused` 동시 true는 발생할 수 없다.
- **(모드C 3라운드 C-001 추가 보강)** 위 결론은 "둘 다 true"는 막지만, "`playbackRef.current`가 이미 사라졌는데도 `isPaused=true`로 잘못 들어가는" 경우는 별도로 막아야 함을 3라운드에서 확인 — "⏸"/"▶" 핸들러 둘 다 시작하자마자 `playbackRef.current`가 살아있는지부터 확인하고, 없으면 아무 상태도 안 바꾸고 끝낸다(아래 코드). 이 가드 하나로 "콜백이 실행되는 정확한 순서가 무엇이든" 상관없이 안전하다 — 세션이 살아있으면 정상적으로 일시정지/재개하고, 이미 끝났으면 둘 다 조용히 no-op.

- 기존 `isPlaying`(boolean, "지금 실제로 재생 중")은 그대로 두고 **새 `isPaused`(boolean) 상태를 추가**(전체를 3상태 union으로 바꾸는 큰 리팩터 대신 최소 침습).
- "⏸ 일시정지" 버튼: `disabled={!isPlaying}`. `onClick`(동기, **모드C 3라운드 C-001 반영 — 맨 앞에 생존 가드 추가**):
  ```ts
  function handlePause() {
    if (!playbackRef.current) return // 이 사이에 세션이 이미 끝났으면(예: 자동 정지) 일시정지로 전환하지 않음
    playbackRef.current.handle.pause()
    playbackRef.current.metronome.stopRinging()
    pauseAutoStopTimer() // §4 아래 "자동 정지 타이머" 참고
    isPlayingRef.current = false
    setIsPlaying(false)
    setIsPaused(true)
  }
  ```
  새 세대 토큰 없이 기존 `playbackRef.current`(이미 "지금 살아있는 세션이 있는지"의 유일한 근거로 쓰이고 있음 — 자동 정지 타이머의 `playbackRef.current?.handle === handle` 가드와 같은 원천)를 그대로 재사용한 것 — 이 가드 하나로 "세션이 이미 끝난 뒤에 일시정지 버튼이 처리되는" 모든 경우(메커니즘이 뭐든)가 안전한 no-op이 됨.
- "▶ 재생" 버튼: `disabled={isPlaying}`(일시정지 중엔 활성 유지). `onClick`(`handlePlay`) **맨 앞, 첫 `await`보다 먼저**(방어적으로 여기도 생존 가드 추가):
  ```ts
  if (isPaused) {
    if (!playbackRef.current) { setIsPaused(false); return } // 이론상 도달 안 해야 하지만 방어적으로
    playbackRef.current.handle.resume()
    resumeAutoStopTimer()
    isPlayingRef.current = true
    setIsPlaying(true)
    setIsPaused(false)
    return
  }
  ```
  새 세션 생성 로직(그 아래의 모든 `await`)을 전부 건너뜀. `isPaused`가 애초에 false면 기존 "처음부터 새 세션 만들기" 로직 그대로.
- "⏹ 정지" 버튼: `disabled={!isPlaying && !isPaused}`. `stopPlayback()`은 끝에서 `setIsPaused(false)`도 같이 리셋(자동 정지·언마운트 cleanup도 전부 `stopPlayback()` 하나를 공유하므로 이 리셋이 모든 경로에 자동으로 적용됨).
- BPM/A-B 루프 입력의 `disabled` 조건: 기존 `isPlaying` 대신 `isPlaying || isPaused`로 바꿔, 일시정지 중에도 계속 잠긴 채 유지(§범위경계).

**(모드C 2라운드 C-002 반영) 자동 정지 타이머 — 기준 시계와 ref 구조를 구체적으로 명시**:
- 루프 모드는 기존 코드(586~587행 `if (loop) return`)에서 이미 이 타이머 자체를 안 건다 — 즉 루프 재생 중엔 아래 ref들이 전부 `null`로 남고, 일시정지/재개 핸들러의 "자동 정지 타이머 처리" 단계는 `if (autoStopRemainingMsRef.current === null) return`으로 조용히 스킵한다(루프 모드와의 상호작용은 "아예 관여 안 함"으로 확정 — 2라운드가 지적한 "규칙 불명확" 해소).
- 새 ref 3개:
  ```ts
  const autoStopTimerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoStopRemainingMsRef = useRef<number | null>(null) // null = 이 세션엔 타이머 자체가 없음(루프 모드)
  const autoStopScheduledAtRef = useRef<number | null>(null) // performance.now() 기준, 지금 돌고 있는 타이머가 "언제" 걸렸는지
  ```
  **기준 시계로 `performance.now()`를 쓴다**(`Date.now()` 아님) — 단조 증가(시스템 시각이 바뀌어도 안 틀어짐)가 보장되는 표준 웹 API라 "경과 시간" 계산에 적합. `setTimeout` 자체의 지연(배경 탭 스로틀링 등)은 이 타이머가 원래부터 "정확한 종료 이벤트가 아니라 안전장치"로 설계됐다는 기존 주석(590~591행 "정확한 종료 이벤트 연결은 범위 밖, 데모용 최소 구현" + 4초 안전 여유)과 같은 수준으로 이미 전제된 특성 — 이번 리비전이 새로 만드는 문제가 아니고, 늦게 발동해도 오디오 자체는 이미 끝나있어 체감 문제가 없음(위험 분류에서 "안전장치" 성격임을 명시).
  - **최초 스케줄**(`handlePlay()` 끝, `if (loop) return` 다음, 기존 587~601행 자리): `autoStopRemainingMsRef.current = totalMs`, `autoStopScheduledAtRef.current = performance.now()`, `autoStopTimerIdRef.current = setTimeout(fn, totalMs)` (`fn`은 기존과 같은 `handle` 아이덴티티 가드 포함).
  - **일시정지 시**: `autoStopRemainingMsRef.current === null`(루프)이면 스킵. 아니면 `clearTimeout(autoStopTimerIdRef.current)`로 확실히 취소(더는 발동 안 함 — 브라우저 보장) → `const elapsed = performance.now() - autoStopScheduledAtRef.current!` → `autoStopRemainingMsRef.current = Math.max(0, autoStopRemainingMsRef.current - elapsed)` → `autoStopTimerIdRef.current = null`.
  - **재개 시**: `autoStopRemainingMsRef.current === null`이면 스킵. 아니면 `autoStopScheduledAtRef.current = performance.now()`, `autoStopTimerIdRef.current = setTimeout(fn, autoStopRemainingMsRef.current)`(같은 `fn`, 같은 `handle` 가드) — 여러 번 일시정지/재개를 반복해도 매번 "그 시점까지 남은 ms"만 다시 거니 누적 오차 없이 정확히 줄어듦.
  - **`stopPlayback()` 안**(정지 버튼·자동 정지 자신·언마운트 cleanup 전부 공유): `if (autoStopTimerIdRef.current !== null) clearTimeout(autoStopTimerIdRef.current)`, `autoStopTimerIdRef.current = null`, `autoStopRemainingMsRef.current = null`, `autoStopScheduledAtRef.current = null` — 다음 `handlePlay()`가 완전히 새로 스케줄하도록 전부 리셋(기존엔 암묵적으로 handle 가드에만 의존했는데, 이제 명시적 `clearTimeout`도 추가해 불필요한 콜백 자체가 큐에 안 남게 함).

## 위험 분류 — Codex 모드C 대상
- **오디오 타이밍·동기**: Transport·분리 오디오 트랙·신스·메트로놈이 전부 같은 지점에서 멈추고 같은 지점에서 다시 맞아야 함. 1라운드 BLOCKING(이미 커밋된 원샷이 자동으로 안 멈춤)을 §3에서 `stopAllRinging()`/`stopRinging()`/`countInSynth.triggerRelease()`로 반영. 특히 §2의 "모바일에서 일시정지 후 재생이 다시 거부되지 않는다"는 가정과 §4의 자동 정지 타이머 재계산이 여전히 실측 검증 대상.
- 새 공개 API·DB 스키마 변경 없음(순수 프런트 재생 상태 기계).

## QA 계획
**(모드C 2라운드 C-007 반영)** 아래 1번(자동 테스트)은 mock 기반이라 "메서드가 올바른 인자로 불렸는지"만 검증하고, 실제 Web Audio 스케줄 취소·release 동작 자체는 검증하지 못한다(jsdom에 Web Audio가 없는 이 모듈 전체의 기존 한계와 동일). 따라서 **2번(실제 브라우저 검증)을 완료 조건의 필수 통과 기준으로 삼는다** — 자동 테스트만 통과하고 브라우저 확인 없이 "완료"로 보고하지 않는다(CLAUDE.md 절대 규칙 3).
1. 자동 테스트:
   - `trackPlayer.test.ts`에 `pause()`/`resume()` 추가 — 언락된 트랙만 멈추는지/다시 play()하는지, 언락 실패 트랙은 둘 다 건너뛰는지.
   - **(구현 중 범위 조정)** `drumVoices.test.ts`에 `stopAllRinging()` 자동 테스트는 추가하지 않음 — `sampleVoice()`가 비공개(export 안 됨)라 직접 단위 테스트하려면 `Tone.Player`/`Tone.ToneAudioBuffer` 전체를 모킹해야 하는데, 이 파일은 기존부터 `trigger()`/`dispose()`도 전혀 단위 테스트하지 않고(jsdom에 Web Audio 디코딩이 없어 `createDrumVoices()` 자체가 안 됨, 파일 상단 기존 주석) 순수 함수(`velocityToDb`)만 테스트해온 선례가 있음 — 같은 기준을 유지. `scorePlayer.ts`도 같은 이유로 테스트 파일이 아예 없음(Transport 의존). 대신 아래 2번(실제 브라우저 검증)이 유일한 검증 경로 — QA계획 맨 위 "필수 통과 기준" 문구와 일관.
2. 실제 브라우저:
   - (a) 재생 중 일시정지 → 소리가 멈추는지 → 재생 → **멈춘 지점부터** 이어지는지(처음으로 안 돌아가는지) 직접 들어서 확인.
   - (b) **1라운드 지적의 핵심 회귀 테스트**: 크래시/라이드처럼 디케이가 긴 피스를 친 "직후"(소리가 아직 울리고 있을 때) 일시정지를 눌러, 소리가 Transport.pause()만으로 안 끊기고 계속 울리던 증상이 재현되지 않는지 직접 들어서 확인.
   - (c) 노트가 막 발화되려는 찰나(스케줄은 이미 커밋됐지만 아직 실제 소리는 안 난 순간) 일시정지를 눌러도 그 노트가 아예 안 들리는지 확인(가능하면 느린 템포로 재현).
   - (d) 일시정지 중 BPM/루프 입력이 잠겨 있는지.
   - (e) 일시정지 중 "정지"를 누르면 완전히 처음으로 돌아가는지.
   - (f) 곡 길이에 비해 충분히 길게 일시정지해뒀다가 재생해서 자동 정지 타이머가 조기 발동하지 않는지.
   - (g) 모바일(가능하면)에서 일시정지→재생이 거부 없이 되는지.
   - (h) 일시정지 버튼을 빠르게 연타해도 에러 없이 안전한지(§1 멱등성 근거).
   - (i) **(2라운드 C-001/C-002 회귀)** 곡이 끝나기 직전(자동 정지 타이머가 곧 발동할 시점)에 일시정지→재개를 반복해도 곡이 실제로 다 끝나기 전엔 자동 정지가 안 일어나는지, 반대로 일시정지해둔 채 충분히 오래 놔둬도(타이머가 멈춰 있으므로) 자동 정지가 "일시정지 중엔" 발동하지 않는지.
   - (j) 재개 버튼을 누른 직후 바로 "정지"를 눌러도(빠른 연속 클릭) 에러 없이 깔끔하게 멈추는지, 이후 "재생"을 누르면 처음부터 정상적으로 새로 시작하는지.
3. 기존 회귀: A-B 루프·BPM 변경·재생 반복(T3-3/T3-4에서 이미 확인한 시나리오)이 이번 변경으로 깨지지 않는지 재확인.

## 가정·한계
- 일시정지 위치는 저장 안 됨(새로고침·곡 이탈 시 사라짐) — REQ-05 "곡별 마지막 설정 기억"과는 무관(범위경계에 명시).
- 일시정지 순간 울리고 있던 소리는 **이어서 재생되지 않고 끊긴다**(크래시 디케이 중간에 멈췄다가 재개해도 그 크래시가 다시 안 울림) — REQ-04 수용 기준("멈춘 지점부터 다시 재생")은 노트가 그 지점부터 다시 트리거되는 것을 요구하는 것이지, 끊긴 디케이 테일의 완벽한 재생이 아님. Tone.js의 `Source.sync()`(Transport의 start/pause 이벤트에 맞춰 소스를 자동으로 멈추고 "중간부터" 재개하는 내장 기능, `Source.js` 225~261행)를 쓰면 이론적으로 디케이 중간 재개까지 가능하지만, 이미 수 차례 모드C/모드A로 검증을 끝낸 기존 노트 스케줄링 경로(절대시각 `transport.schedule()` + 언싱크 `player.start(time)`) 전체를 바꿔야 해 위험 대비 이득이 작다고 판단(최소 침습 원칙) — 채택 안 함.
- 메트로놈·카운트인 클릭의 `triggerRelease()`는 "완전 무음"이 아니라 "release 커브를 지금부터 다시 타는 것"이라 아주 짧은 테일이 남을 수 있음(기본 release 1.4초 중 이미 지난 만큼을 뺀 나머지가 아니라, 그 시점부터 다시 1.4초짜리 release 곡선을 타므로 실제로는 더 빨리 0에 수렴하지만 완벽히 0ms는 아님) — 드럼 원샷(수 초간 또렷하게 들리는 크래시 등)과 달리 체감상 무시 가능한 수준으로 판단, 완전 무음화(`volume=-Infinity` 임시 설정 등)는 지퍼 노이즈 위험이 있어 채택 안 함.
- 모바일 "일시정지 후 재생이 다시 거부되지 않는다"는 가정은 일반적인 웹 플랫폼 동작에 근거하되, 실기기로 직접 재현 검증은 QA 단계에서.
