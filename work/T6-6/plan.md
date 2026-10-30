> 한 줄 요약: T6-6 설계안 — iOS에서 실제 음원(스템) Web Audio 브리지를, Tone.js가 Transport·가상드럼에 쓰는 공유 AudioContext가 아니라 완전히 별도의 전용 AudioContext로 분리한다. 실기기 라이브 실험으로 "공유 컨텍스트 자체"가 원인임을 확정(T6-5 result.md). 구현 전 설계 기록(Codex 모드C 검수 전).

# T6-6 설계안 — iOS 음원 전용 AudioContext 분리

근거: `qa-evidence/T6-5/result.md`, `intent/07-open-questions.md` Q-33(T6-6 원인 추가 좁힘 섹션).

## 문제 (T6-5 실기기 재측정으로 추가 확정)

T6-5(44100Hz 고정)는 격리 테스트(드럼 1개)에서는 측정 가능한 개선이 있었으나(20~40→50~55대), **실제 사용 시나리오(드럼+음악 2개 동시)는 체감·수치 모두 변화 없음(30~50대, 렉 심함)**. 의뢰인 실기기 콘솔 라이브 실험으로 추가 확정:

1. **완전히 별도의** 새 AudioContext(44100Hz)에 드럼+음악 2개를 새로 연결해 동시 재생(가상드럼·Transport 스케줄러는 그대로 돌아가는 채로) → **60fps 깨끗함**.
2. 반면 **앱이 실제로 쓰는 Tone.js 공유 컨텍스트**(T6-5로 이미 44100Hz인 바로 그 컨텍스트)에 **새로 만든** 엘리먼트로 드럼+음악 2개를 연결 → **렉 재현**(기존 풀 엘리먼트가 오래 써서 상태가 꼬인 것도 원인이 아님을 함께 확정 — 새 엘리먼트인데도 재현됨).

**결론(Codex 모드C 1차 C-005 반영, 표현 완화)**: 동시 스트림 개수도, Web Audio 우회 경로 자체도, 특정 엘리먼트의 상태도 아니고 — **Tone.js가 Transport·가상드럼(synth voice)에 쓰는 바로 그 공유 AudioContext 위에 실제 음원(MediaElementAudioSourceNode)을 같이 얹는 것**이 유력한 원인일 **가능성이 높다**(두 라이브 실험의 대조가 유의미한 근거이긴 하나, 비교 조건이 모든 면에서 완전히 통제됐다고 단정할 근거까지는 없음 — 예: 실험에 쓴 엘리먼트 생성·재생 경로가 앱의 정상 재생 경로와 세부까지 동일했는지는 기록만으론 확인 불가). 정확한 내부 메커니즘(Tone의 내부 스케줄러·Destination 체인과 무엇이 어떻게 부딪히는지)은 코드/공식 문서로 아직 확인 못 함 — 모르는 부분은 모른다고 명시(CLAUDE.md §1-1). 그래서 이 설계의 진짜 검증 기준은 "가정이 그럴듯한가"가 아니라 **구현 후 실제 앱 재생 버튼 경로로 동시 stem 재생 시 fps가 실제로 60 근처까지 올라오는가**(아래 테스트 계획) 하나뿐이다.

## 설계

### 핵심 아이디어

iOS에서 실제 음원 재생(`trackPlayer.ts`)만 **Tone과 완전히 분리된 전용 AudioContext**를 쓰게 한다. 가상드럼·메트로놈·Transport 스케줄링은 기존 Tone 컨텍스트를 그대로 쓰고 손 안 댐 — 이 둘이 "따로는 멀쩡하다"는 게 이미 실기기로 확인됐으므로, 분리 자체가 해결책이 될 가능성이 높다(아직 구현 전 가설이지만 가장 근거 있는 다음 시도).

### 왜 동기화가 안 깨지는가

`trackPlayer.ts`의 `playFrom()`/`seekTo()`/`resync()`는 Transport의 스케줄 콜백이 **트리거**(언제 부를지)만 담당할 뿐, 실제 오디오 엘리먼트 재생 자체는 일반 JS 호출(`element.play()`/`element.currentTime` 대입)이지 Tone.Transport 자체의 오디오 그래프 스케줄링이 아니다(기존 코드 확인됨 — `playFrom()` 안에 `Tone.Transport` 관련 호출이 전혀 없음). 즉 이 엘리먼트들이 **어느 AudioContext의 그래프에 연결되는지**는 "언제 play()가 불리는지"와 독립적 — 그래프 연결 대상 컨텍스트만 바꿔도 Transport 기반 동기화 로직엔 영향이 없을 것으로 설계한다. **다만 이건 코드 근거이지 실기기 확인은 아직 아님 — 구현 후 반드시 실기기로 "노트와 소리가 여전히 맞는지" 재확인 필요(아래 테스트 계획).**

### `platformAudioContext.ts`에 새 함수 추가

```ts
let stemContext: AudioContext | null = null
let stemContextAttempted = false

/** iOS에서만, 스템(실제 음원) Web Audio 브리지 전용의 **Tone과 완전히 분리된** AudioContext를
 * 지연 생성(최초 호출 시 1번만 시도, 성공/실패와 무관하게 이후 호출은 같은 결과를 반환 —
 * 실패를 매번 재시도하면 반복 실패 시 매번 AudioContext 인스턴스가 새로 생겼다 버려지는
 * 낭비가 생기므로, 이 함수는 T6-5의 ensureIOSAudioContextSampleRate()와 달리 **재시도하지
 * 않음**(실패하면 trackPlayer.ts가 Tone 공유 컨텍스트로 폴백 — 아래 "실패 시 동작" 참고,
 * 그 폴백 경로 자체가 이미 "그나마 동작은 하는" 상태라 재시도 압박이 적음).
 * 비iOS는 항상 null(코드 경로 자체가 안 바뀜).
 */
export function getIOSStemAudioContext(): AudioContext | null {
  if (!isIOS()) return null
  if (stemContextAttempted) return stemContext
  stemContextAttempted = true
  try {
    stemContext = new AudioContext({ sampleRate: 44100 })
  } catch {
    stemContext = null
  }
  return stemContext
}
```

### `trackPlayer.ts` 변경

- `createAudioTrackPool()`의 컨텍스트 선택 로직을 바꾼다:
  ```ts
  const stemContext = getIOSStemAudioContext() // iOS 아니면 null
  const useWebAudioForVolume = stemContext !== null
  // buildTrack() 안에서 Tone.getContext().rawContext 대신 stemContext(non-null 보장된 상태) 사용
  ```
  **실패 시 동작(iOS인데 전용 컨텍스트 생성 자체가 실패하는 드문 경우)**: `useWebAudioForVolume`이 false가 돼버리면 iOS에서 `element.volume`으로 폴백하게 되는데, Q-32에서 확인했듯 iOS는 `element.volume`을 무시 — 음량 조절이 완전히 안 먹히는 더 나쁜 상태가 된다. 그래서 **생성 실패 시에는 T6-5의 `ensureIOSAudioContextSampleRate()`가 이미 설정해둔 Tone 공유 컨텍스트로 폴백**(T6-5 merge 이전 상태와 동일 — 느리지만 음량 조절은 됨):
  ```ts
  const stemContext = getIOSStemAudioContext() ?? (isIOS() ? (Tone.getContext().rawContext as unknown as AudioContext) : null)
  const useWebAudioForVolume = stemContext !== null
  ```
- **사용자 제스처 안에서 resume() 필요**: Tone의 컨텍스트는 `createDrumVoices()`의 `Tone.start()`가 자동으로 resume시켜주지만, 이 새 전용 컨텍스트는 아무도 resume 안 시켜준다. `trackPlayer.ts`의 `prime()` 함수 맨 첫 줄(`if (primePromise) return primePromise`보다도 먼저 — 두 번째 호출부터는 이 줄 자체를 안 타므로, 자원 소모 없는 `resume()` 호출을 early-return 가드보다 앞에 둬도 무해하고, 혹시 모를 호출 순서 변경에도 안전)에 `void stemContext?.resume()` 추가.
  **(Codex 모드C 1차 C-001 검토)** Codex는 "`handlePlay()`가 `tracks?.prime()`보다 먼저 `await createDrumVoices()`를 실행해서 resume() 시점엔 이미 제스처가 식어있을 수 있다"고 지적했으나, 실제 `PracticeCanvas.tsx`(1390~1419줄)를 직접 다시 읽어 확인한 결과 **순서가 반대**다 — `tracks?.prime()` **호출**(`const primePromise = tracks?.prime()`, 1394줄)이 `await createDrumVoices(...)`(1419줄)보다 먼저 실행되고, 그 사이에 `await`가 전혀 없다(T3-3 당시부터 "prime()의 각 트랙 play()+pause() 호출은 아래 await 이전에 동기적으로 시작돼야 모바일 제스처 체인이 보존된다"고 명시적으로 설계·주석된 기존 불변식, 1325~1328줄). `prime()` 호출 자체는 동기 함수 호출이고, 그 안의 `Promise.all(tracks.map(async track => { ... await track.element.play() ... }))`도 `.map()`이 각 트랙의 async 콜백을 동기적으로 실행하다가 **콜백 내부의 첫 `await`**(`track.element.play()` 호출 자체는 그 전에 동기 실행됨)에서만 멈춘다 — 즉 기존 Tone 언락 트릭이 지금도 정상 동작하고 있다는 사실 자체가 이 제스처 체인이 살아있다는 증거. `stemContext?.resume()`을 `prime()`의 맨 앞(동기 구간)에 두면 **같은 체인, 같은 타이밍**으로 호출되므로 기존 `track.element.play()`와 동등한 보장을 받는다. **다만 이건 코드 근거일 뿐 실기기 확인은 아직 아님** — Codex의 우려 자체는 타당한 종류의 질문이라, 아래 테스트 계획의 "최초 언락" 항목을 통과 기준으로 유지한다(코드가 맞다고 확신해도 실기기 미확인 상태로 완료 주장 안 함, CLAUDE.md §1-3).

### 컨텍스트 생성 시점·수명(Codex 모드C 1차 C-002 반영)

`getIOSStemAudioContext()`는 `createAudioTrackPool()`(화면 진입 시 자동 실행, 사용자 제스처 전)에서 호출되므로 제스처 전에 생성됨 — 다만 그래프 **구성**(노드 생성·연결)은 컨텍스트가 suspended여도 가능하고 실제 **소리가 나는 시점**(resume 이후)과는 분리된다는 게 기존 Tone 경로(T3-12 당시 설계, trackPlayer.ts 상단 주석)와 동일한 전제라 새로운 위험은 아니다. Codex가 지적한 "반복 마운트·StrictMode·풀 재생성 시 컨텍스트가 누적되는지"는 **모듈 스코프 싱글턴**(`stemContext`/`stemContextAttempted`가 `platformAudioContext.ts` 모듈 레벨 변수)이라 걱정과 달리 안전하다 — React StrictMode의 "마운트→정리→재마운트" 이중 호출은 **컴포넌트 렌더/이펙트**에만 적용되고 모듈 최상위 상태(이 변수들)는 영향받지 않는다(T6-5의 `configured` 플래그와 완전히 같은 패턴 — T6-5 구현 때 이미 같은 구조로 테스트·실측 둘 다 통과한 전례). 곡을 여러 번 바꿔 `createAudioTrackPool()`이 여러 번 불려도 `getIOSStemAudioContext()`는 "최초 1회 시도, 이후 같은 인스턴스(or 계속 null)"만 반환 — 새 컨텍스트가 추가로 생기지 않는다. 다만 "실기기에서 AudioContext 개수 자체에 상한이 있는지"는 코드로 확인 불가능한 플랫폼 동작이라 실기기 테스트로만 간접 확인(정상 동작하면 문제없다는 뜻으로 해석).

### 노드 구성 자체가 실패하는 경우(Codex 모드C 1차 C-003 반영)

`getIOSStemAudioContext()`의 생성 실패(폴백 대상)는 `new AudioContext()` 생성자 자체가 던지는 경우만 처리한다. 컨텍스트 생성은 성공했는데 `buildTrack()` 안의 `createMediaElementSource()`/`createGain()`/`connect()`가 실패하는 경우는 기존 `createAudioTrackPool()`의 실패 처리 경로(실패한 트랙·이미 성공한 트랙 전부 `destroyTrack()`으로 정리 후 reject, 240~263줄)가 **이미** 커버한다 — 이번 변경으로 새로 생기는 위험이 아니라 T6-5 이전부터 있던 기존 동작 그대로. Codex의 "Tone 컨텍스트로 재시도해야 하는가"는 **일부러 안 한다** — 같은 `<audio>` 엘리먼트를 서로 다른 컨텍스트에 연결 시도하는 재시도 로직은 상태가 꼬일 위험이 더 크고(Codex도 "피해야 한다"고 동의), 풀 생성 실패 자체는 `PracticeCanvas.tsx`에 이미 있는 "신스 폴백 + 눈에 보이는 배너 + 재시도 버튼"(2026-10-29, 의뢰인 요청) 경로가 사용자에게 투명하게 처리해준다 — 새 코드 불필요, 기존 안전망 재사용.

### T6-5는 그대로 유지

Tone 공유 컨텍스트를 44100Hz로 고정하는 T6-5의 `ensureIOSAudioContextSampleRate()`는 되돌리지 않는다 — (a) 위 "실패 시 폴백" 경로가 그 컨텍스트를 그대로 재사용하고, (b) 가상드럼 샘플 재생(`Tone.ToneAudioBuffer`)도 어차피 44100Hz 쪽이 리샘플링이 덜 필요할 가능성이 있어 해가 되지 않음(이 부분은 확인된 사실이 아니라 추정 — 단정하지 않음).

## 테스트 계획

- 단위 테스트: `getIOSStemAudioContext()` — iOS/비iOS 분기, 1회만 시도(재시도 안 함, 실패해도 매번 같은 null), 두 번째 호출이 같은 인스턴스를 반환(싱글톤). `createAudioTrackPool()`이 Tone 컨텍스트가 아니라 이 전용 컨텍스트를 쓰는지(모킹으로 두 컨텍스트를 구분 가능하게 해서 검증). **(Codex 모드C 1차 C-004 반영, 추가)** 생성 실패 시 Tone 컨텍스트로 정확히 폴백하는지(모킹으로 `getIOSStemAudioContext()`가 null을 반환하게 만들고 `createAudioTrackPool()`이 Tone의 `rawContext`를 쓰는지 확인), `resume()`이 reject해도(Promise) 풀 생성 자체가 안 깨지는지(`void`로 무시하는 설계이므로 reject가 전파 안 됨을 확인).
- 기존 테스트 전부(`vitest`/`tsc`/`oxlint`) 회귀 없음.
- **데스크톱 회귀**: `isIOS()`가 false라 `getIOSStemAudioContext()`가 항상 null → 코드 경로 자체가 T6-5 이전과 동일. 실제 재생도 눈으로 재확인.
- **아이폰 실기기 재검증(중요, 전부 확인 전까지 완료 아님)**:
  1. 새로고침 → 재생 버튼 최초 탭 → 소리 바로 나오는지(최초 언락 경로, T6-5 C-004와 동일 이유로 재확인 필요 — 이번엔 전용 컨텍스트의 resume() 타이밍도 같이 걸림).
  2. 노트와 실제 소리(드럼 타격 위치)가 맞는지(동기화 안 깨졌는지 — "설계" 절의 가정이 실제로 맞는지).
  3. 평소처럼 재생 — fps가 60 근처로 올라오는지(이번이 핵심 검증 포인트).
  4. 믹서 음량 조절이 여전히 되는지.

## 리스크

- resume() 타이밍이 Tone.start()의 기존 타이밍과 미묘하게 달라 "최초 재생 시 소리 한 박자 늦게 시작" 같은 문제가 생길 가능성 — 실기기로만 확인 가능, 코드 추측으로 안전하다고 단정하지 않음.
- 두 개의 서로 다른 AudioContext가 동시에 떠 있는 상태 자체가 iOS에서 추가 메모리/배터리 비용을 유발할 가능성 — 작은 손실일 것으로 예상하나 측정 안 함(fps 목표 달성이 우선, 확인되면 별도 항목으로 기록).
- "그래프 연결 대상만 바꿔도 동기화에 영향 없다"는 설계 가정이 실기기에서 틀릴 수 있음 — 그 경우 Phase 1(Root Cause Investigation)로 다시 돌아가 재조사.
