> 한 줄 요약: T3-6(REQ-04) 설계안 — "일시정지"(멈춘 지점부터 이어재생). Tone.js Transport가 이미 `pause()`+`start()`(오프셋 없이)로 진짜 멈춘 지점 재개를 지원함을 실제 설치된 소스로 확인, 그 위에 분리 오디오 트랙(HTMLAudioElement)·자동 정지 타이머를 맞춰 넣는다. "오디오 타이밍·동기" 위험 작업 — 구현 전 Codex 모드C 검수 대상.

# T3-6 일시정지/이어재생 — 설계

## 근거 REQ
REQ-04(2026-10-25 추가, 의뢰인 요청): "일시정지/이어재생 — 멈춘 지점부터 다시 재생. 기존 '정지'(처음으로 되돌아가는 것)와는 별개 동작."

## 범위 경계
- **포함**: "⏸ 일시정지" 버튼 신설(재생 중에만 활성). 일시정지 중 "▶ 재생"을 누르면 멈춘 지점부터 재개. 기존 "⏹ 정지"는 그대로 "처음(카운트인 포함)으로 되돌아가며 완전히 멈춤" 동작 유지(의뢰인 요청에 명시된 대로 "정지와는 별개").
- **제외**: 일시정지 중 BPM/A-B 루프 변경(기존에도 재생 중엔 잠겨 있었음 — 일시정지도 "재생 세션이 살아있는 상태"로 취급해 계속 잠금, 과한 설계 방지). 일시정지 상태의 서버 저장(새로고침하면 처음부터 — REQ-05의 "곡별 마지막 설정 기억"은 믹서 볼륨/음소거/솔로에 한정된 것이지 재생 위치가 아님, 범위 밖).

## 설계

### 1. Tone.Transport의 네이티브 일시정지 지원(실제 소스로 확인, 추측 아님)
설치된 Tone.js(15.1.22) 소스(`node_modules/tone/build/esm/core/clock/{Transport,Clock,TickSource}.js`)를 직접 읽어 확인:
- `Transport.pause(time)` → `Clock.pause(time)` → `TickSource.pause(time)` — 틱(위치)을 **리셋하지 않고** 상태만 `"paused"`로 바꿈.
- `TickSource.start(time, offset)`: `offset`이 **주어지지 않으면** 틱을 그대로 두고 그 위치에서부터 다시 흐르기 시작(소스 62~68행, `if (isDefined(offset)) { this.setTicksAtTime(...) }` — offset 없으면 이 분기 자체가 안 돎).
- 결론: **`transport.pause()` 후 `transport.start()`(오프셋 없이)를 호출하면 멈춘 지점부터 정확히 재개된다** — 이미 예약된 모든 이벤트(노트·메트로놈·카운트인 클릭, 전부 `transport.schedule()`/`scheduleRepeat()`로 절대 시각 기준 예약돼 있음)가 Transport 자신의 틀 안에서 그대로 유효하므로, 일시정지·재개 자체에 추가 재스케줄링이 전혀 필요 없다. A-B 루프 설정(`transport.loop`/`setLoopPoints`)도 Transport의 별개 속성이라 일시정지·재개에 영향받지 않음.

### 2. 분리 오디오 트랙(`trackPlayer.ts`) — 새 메서드 2개
```ts
pause(): void   // 언락된 트랙만 .pause()(HTMLMediaElement 네이티브 — currentTime은 그대로 보존됨, 스펙 보장)
resume(): void  // 언락된 트랙만 .play() 재호출(모바일 제스처 재차단 걱정 없음 — 이미 한 번 제스처 안에서 성공적으로 재생된 엘리먼트는 이후 play()가 "블레스"된 상태로 유지되는 게 표준 동작, 일반적인 웹 미디어 플레이어의 일시정지/재생 버튼과 같은 원리)
```
- `resync()`는 수정 불필요 — 기존 가드(`track.element.paused`면 건너뜀)가 일시정지 중엔 자연히 아무것도 안 함.
- `playFrom()`/`stop()`도 수정 불필요(이번에 새로 건드리는 건 pause/resume 경로뿐).

### 3. `scorePlayer.ts`의 `PlaybackHandle`에 `pause()`/`resume()` 추가
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
  tracks?.pause()
},
resume() {
  transport.start() // 오프셋 없음 — §1에서 확인한 대로 멈춘 지점부터 재개
  tracks?.resume()
},
```
신스 드럼(`drumVoices.ts`)·메트로놈(`metronome.ts`)은 둘 다 Transport가 스케줄하는 이벤트(`Tone.Player.start(time)`, `transport.scheduleRepeat()`)로만 소리를 내므로 **별도 pause/resume 코드가 필요 없음** — Transport 자체가 멈추고 재개되면 자동으로 같이 멈추고 재개됨(§1의 근거 그대로).

### 4. `PracticeCanvas.tsx` 연동
- 기존 `isPlaying`(boolean, "지금 실제로 재생 중")은 그대로 두고 **새 `isPaused`(boolean) 상태를 추가**(전체를 3상태 union으로 바꾸는 큰 리팩터 대신 최소 침습 — 기존 `isPlaying` 의존 코드(BPM/루프 잠금, 킷 점등 가드 등)를 전부 뜯어고치지 않음).
- "⏸ 일시정지" 버튼: `disabled={!isPlaying}`. `onClick`: `playbackRef.current?.handle.pause()`, `isPlayingRef.current = false`(킷 점등 가드 — 정지 때와 같은 이유로 멈춘 위치에 노트가 있어도 계속 켜진 채 안 남게), `setIsPlaying(false)`, `setIsPaused(true)`.
- "▶ 재생" 버튼: `disabled={isPlaying}`(일시정지 중엔 활성 유지 — 지금과 동일 조건, 추가 분기 불필요). `onClick`(`handlePlay`) 맨 앞에서 분기: `isPaused`면 `playbackRef.current?.handle.resume(); isPlayingRef.current = true; setIsPlaying(true); setIsPaused(false)`로 끝(새 세션을 만드는 기존 로직 전체를 건너뜀). 아니면 기존 "처음부터 새 세션 만들기" 로직 그대로.
- "⏹ 정지" 버튼: `disabled={!isPlaying && !isPaused}`(지금은 `!isPlaying`뿐 — 일시정지 중에도 눌러서 완전히 멈출 수 있어야 함). `stopPlayback()`은 끝에서 `setIsPaused(false)`도 같이 리셋.
- BPM/A-B 루프 입력의 `disabled` 조건: 기존 `isPlaying` 대신 `isPlaying || isPaused`로 바꿔, 일시정지 중에도 계속 잠긴 채 유지(§범위경계).
- **자동 정지 타이머(모드C 검수 전 미리 식별한 위험)**: 기존 코드는 `handlePlay()` 시점에 `setTimeout(stopPlayback, totalMs)`로 "실제 시간이 totalMs만큼 지나면 자동 정지"를 건다 — **일시정지로 멈춰 있던 시간도 그대로 흘러가 버리므로, 곡이 실제로 끝나기 전에 타이머가 먼저 발동해 조기 정지시킬 위험**이 있다. 수정: 이 타이머의 ID와 "원래 걸었던 총 시간" 대신 "남은 시간"을 `useRef`로 들고 있다가, 일시정지 시 `clearTimeout`하고 그 시점까지 남은 ms를 계산해 저장, 재개 시 그 남은 ms로 새 타이머를 다시 건다(루프 모드는 애초에 이 타이머를 안 걸므로 영향 없음).

## 위험 분류 — Codex 모드C 대상
- **오디오 타이밍·동기**: Transport·분리 오디오 트랙·신스·메트로놈이 전부 같은 지점에서 멈추고 같은 지점에서 다시 맞아야 함(§1~3). 특히 §2의 "모바일에서 일시정지 후 재생이 다시 거부되지 않는다"는 가정과 §4의 자동 정지 타이머 재계산이 실측 검증 대상.
- 새 공개 API·DB 스키마 변경 없음(순수 프런트 재생 상태 기계).

## QA 계획
1. 자동 테스트: `trackPlayer.test.ts`에 `pause()`/`resume()` 추가 — `.pause()`가 언락된 트랙만 멈추는지, `.resume()`이 언락된 트랙만 다시 play()하는지, 언락 실패 트랙은 둘 다 건너뛰는지.
2. 실제 브라우저: (a) 재생 중 일시정지 → 소리가 멈추는지 → 재생 → **멈춘 지점부터** 이어지는지(처음으로 안 돌아가는지) 직접 들어서 확인. (b) 일시정지 중 BPM/루프 입력이 잠겨 있는지. (c) 일시정지 중 "정지"를 누르면 완전히 처음으로 돌아가는지. (d) 곡 길이에 비해 충분히 길게 일시정지해뒀다가 재생해서 **자동 정지 타이머가 조기 발동하지 않는지**(남은 시간 재계산 검증 — 이게 이번 작업에서 가장 놓치기 쉬운 부분). (e) 모바일(가능하면)에서 일시정지→재생이 거부 없이 되는지.
3. 기존 회귀: A-B 루프·BPM 변경·재생 반복(T3-3/T3-4에서 이미 확인한 시나리오)이 이번 변경으로 깨지지 않는지 재확인.

## 가정·한계
- 일시정지 위치는 저장 안 됨(새로고침·곡 이탈 시 사라짐) — REQ-05 "곡별 마지막 설정 기억"과는 무관(범위경계에 명시).
- 모바일 "일시정지 후 재생이 다시 거부되지 않는다"는 가정은 일반적인 웹 플랫폼 동작에 근거하되, 실기기로 직접 재현 검증은 QA 단계에서.
