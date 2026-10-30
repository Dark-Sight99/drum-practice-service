> 한 줄 요약: T6-5 설계안 — iOS에서만 Tone.js 공유 AudioContext를 44100Hz로 고정해(서버 mp3와 샘플레이트 일치) 실기기로 확정한 리샘플링 성능 문제를 해결한다. Codex 모드C 1차(수정 후 진행, C-001~C-005) 전부 반영 완료, 구현 시작.

# T6-5 설계안 — iOS AudioContext 샘플레이트 고정

근거: `intent/05-todo.md` Phase 6, `intent/07-open-questions.md` Q-33(T6-4 결과 섹션).

## 문제 (T6-4 실기기 확정)

- 서버가 만드는 스템 mp3는 44100Hz(ffmpeg 번들 바이너리로 직접 `-i` 프로브해 확인, 인코딩 시 `-ar` 미지정이라 Demucs 기본 출력 샘플레이트 그대로).
- 의뢰인 아이폰의 기본 `AudioContext` 샘플레이트는 48000Hz(`new AudioContext().sampleRate`로 실측).
- `trackPlayer.ts`가 iOS에서만 쓰는 Web Audio 우회 경로(`createMediaElementSource()`+`GainNode` — T3-12/Q-32, iOS `element.volume` 무시 버그 대응)가 이 48000↔44100 불일치 때문에 매번 실시간 리샘플링을 해야 해서 fps 저하(20~40대)의 직접 원인임을 실기기 라이브 실험으로 확정:
  1. 같은 파일을 Web Audio 없이 평범한 `new Audio()`로 재생 → 렉 없음(60fps).
  2. 같은 우회 경로(createMediaElementSource+GainNode)인데 **44100Hz로 맞춘 별도 AudioContext**로 재생 → 렉 사라짐(60fps).
  3. iOS는 여전히 `element.volume` 직접 설정을 무시함(재확인됨) — Web Audio 우회 자체는 계속 필요.

## 왜 iOS만

- `useWebAudioForVolume = isIOS()`(`trackPlayer.ts`)로 이미 iOS만 이 우회 경로를 씀 — 안드로이드·데스크톱은 `element.volume`을 직접 쓰고 Web Audio를 아예 안 거치므로 이 리샘플링 문제 자체가 발생하지 않음(의뢰인 확인 완료, 이 대화에서).
- 데스크톱/안드로이드는 컨텍스트 생성 코드 경로를 전혀 안 바꿔 회귀 위험을 원천적으로 없앤다.

## 설계

### 어디서 설정하나

Tone.js의 공유 AudioContext는 **처음 접근하는 시점에 지연 생성**된다(`Tone.getContext()`/`Tone.start()`/`Tone.getTransport()`를 처음 호출하는 순간 — import 시점이 아니라 실제 함수 호출 시점, 어느 Tone 소스 모듈도 모듈 최상위에서 Tone API를 호출하지 않음을 grep으로 확인). 이 프로젝트에서 Tone을 건드리는 지점이 **하나가 아니다**:

- `trackPlayer.ts`의 `createAudioTrackPool()` — 화면 진입 직후 자동.
- `drumVoices.ts`의 `createDrumVoices()` — 재생 버튼 누를 때.
- `scorePlayer.ts`/`metronome.ts`/`clock.ts`의 `Tone.getTransport()` — `clock.ts`의 `getMasterClock()`은 T6-1에서 캔버스 렌더 루프 쪽으로 호이스팅돼 더 이르게 호출될 수도 있어, 어느 게 "진짜 첫 접근"인지 React 이펙트 실행 순서에 의존하게 돼 추적하기 번거롭고 깨지기 쉬움.

그래서 각 진입점마다 가드를 넣는 대신, **앱 부트스트랩(`main.tsx`) 맨 앞, `createRoot(...).render()`보다 먼저** 단 한 곳에서 호출한다 — React 컴포넌트가 하나도 마운트되기 전이라 위 네 곳 중 무엇이 먼저 실행되든 전부 이미 늦은 시점이 되므로, 순서를 추적할 필요 자체가 없어진다.

**(Codex 모드C 1차 C-001 반영)** 이 전제가 성립하려면 "함수 호출 시점"뿐 아니라 **import 평가 시점**(ES 모듈은 정적 import 전체가 먼저 평가된 뒤에야 `main.tsx` 본문이 실행됨)에도 Tone API를 건드리는 코드가 없어야 한다. `app/web/src`에서 `Tone\.(start|getContext|setContext|getTransport)\(` 전체를 grep한 결과(위 "어디서 설정하나" 절), 매칭된 자리는 전부 `export function ...` 본문 **안**이고(모듈 최상위 문장 아님) 어느 것도 함수 밖에서 즉시 실행되지 않음을 확인했다(아래 4곳 전부: `createAudioTrackPool`, `createDrumVoices`, `scorePlayer.ts`/`metronome.ts`/`clock.ts`의 함수들). 즉 `main.tsx`가 이 모듈들을 (직접이든 `App.tsx`를 거쳐 간접이든) import하는 시점엔 아직 아무 Tone 호출도 안 일어나고, 실제 호출은 전부 React 컴포넌트가 마운트되고 이펙트/이벤트 핸들러가 실행된 **뒤**에야 일어난다 — `main.tsx`의 동기 호출이 이 전부보다 이르다는 결론이 유지된다. 구현 시 `app/web/node_modules` 등 서드파티 코드까지 포함한 전수 검증은 아니므로(Codex도 "직접 재현하지 않았다"고 명시), 구현 직후 **실제 네트워크 탭/콘솔 로그로 `Tone.setContext()`가 다른 어떤 Tone 호출보다 먼저 실행됐는지**(예: `ensureIOSAudioContextSampleRate()` 안에 임시 `console.log`를 넣어 실기기에서 타임스탬프 순서를 1회 확인) 재검증한다.

### 새 모듈: `app/web/src/audio/platformAudioContext.ts`

```ts
/** trackPlayer.ts의 기존 isIOS()와 동일 로직(모드A 지적 반영 버전)을 이 모듈로 옮기고
 * export — trackPlayer.ts는 이 함수를 import해서 쓴다(로직 중복 방지). */
export function isIOS(): boolean { /* ... */ }

let configured = false

/** main.tsx에서 createRoot().render() 전에 **단 한 번, 동기로** 호출돼야 함(아래 "호출
 * 지점" 참고) — 앱 안에서 Tone.js API를 처음 건드리는 어떤 코드보다도 먼저 실행시키는
 * 게 핵심. iOS에서만, 서버 mp3 샘플레이트(44100Hz, 현재 인코딩 기준 — 서버가 다른
 * 레이트로 바꾸면 이 숫자도 실기기로 재검증 필요)와 맞춘 AudioContext로
 * Tone.setContext()를 미리 해둬 T6-4에서 확정한 리샘플링 비용을 없앤다.
 *
 * Codex 모드C 1차 C-002 지적 반영 — `configured`는 **성공했을 때만** true로 올린다(생성
 * 또는 setContext()가 실패하면 false로 남겨, 혹시 이 함수가 다시 호출될 기회가 있으면
 * (예: Vite HMR이 main.tsx를 재실행하는 드문 경우) 재시도할 수 있게). 실패는 조용히
 * Tone 기본 컨텍스트로 넘어간다(안 하는 것보다 나을 게 없을 뿐, 기존 동작으로 폴백이라
 * 안전).
 */
export function ensureIOSAudioContextSampleRate(): void {
  if (configured || !isIOS()) return
  try {
    const context = new AudioContext({ sampleRate: 44100 })
    Tone.setContext(context)
    configured = true
  } catch {
    /* 폴백: Tone이 알아서 기본 컨텍스트를 만들게 둔다. configured는 false로 남겨 재시도
     * 가능성을 열어둠(Codex C-002). */
  }
}
```

### 호출 지점

`main.tsx`:
```ts
import { ensureIOSAudioContextSampleRate } from './audio/platformAudioContext.ts'

ensureIOSAudioContextSampleRate()

createRoot(document.getElementById('root')!).render(/* ... */)
```

### 왜 멱등 가드가 필요한가

`main.tsx`는 앱 수명 동안 한 번만 실행되므로 엄밀히는 필수는 아니지만, Vite HMR(개발 모드 핫리로드)이 `main.tsx`를 다시 실행시키는 경우(드묾, 보통은 컴포넌트 단위 리로드)를 대비한 저비용 방어선으로 `configured` 플래그를 유지한다 — 두 번째 호출이 새 AudioContext를 또 만들어 Tone을 또 스왑하면 그 시점에 이미 재생 중이던 소리가 끊길 수 있기 때문.

**(Codex 모드C 1차 C-003 반영)** `configured`는 모듈 인스턴스에 묶인 변수라, Vite HMR이 `platformAudioContext.ts` 자체를 재평가하면(이 모듈만 바뀌었을 때) 가드가 초기화돼 재설정이 다시 일어날 수 있음 — 이건 **개발 모드 한정** 현상이고(프로덕션 빌드는 모듈이 재평가되는 일 자체가 없음), 재설정이 일어나면 그 순간 재생 중이던 소리가 끊기는 정도의 영향(앱이 깨지거나 데이터가 손상되는 건 아님) — 개발 중 감수 가능한 수준으로 판단, 별도 방어 코드 추가 안 함. 프로덕션 사용자는 영향 없음.

## 테스트 계획

- 단위 테스트: `ensureIOSAudioContextSampleRate()` — iOS 판별 시 `Tone.setContext()` 호출, 비iOS는 호출 안 함, 두 번째 호출은 아무 일도 안 함(기존 trackPlayer.test.ts의 'tone' 모듈 모킹 패턴 재사용).
- 기존 테스트 전부(`vitest`, `tsc --noEmit`, `oxlint`) 회귀 없음 확인.
- **실기기 회귀**: 데스크톱(맥/윈도우 둘 다) 연습 화면에서 음악·메트로놈 소리·믹서 조작 정상 동작 확인(이 경로는 애초에 `isIOS()`가 false라 코드 경로 자체가 안 바뀌지만, 실제로 안 바뀌었는지 눈으로 재확인).
- **아이폰 재측정**: 연습 화면 재생 중 fps가 60 근처로 올라오는지, 믹서 음량 조절이 여전히 되는지(Web Audio GainNode 경로는 그대로 유지되므로 되어야 함) 의뢰인이 직접 확인.
- **아이폰 최초 언락 경로 확인(Codex C-004 반영, 신규)**: 새로고침 → 연습 화면 진입 → 재생 버튼 **최초** 탭 → 드럼·음악 소리가 바로 나오는지(지연·무음 없이). 지금까지의 T6-4 실험은 전부 "이미 재생 중인" 상태를 콘솔로 조작한 것이라, AudioContext를 사용자 제스처 전에 미리 만드는 이 변경이 최초 언락 자체에 영향 없는지는 아직 실측된 적 없음 — 반드시 확인.

## 리스크

- 일부 구형/특이 기기가 `new AudioContext({ sampleRate: 44100 })` 자체를 거부(throw)할 가능성 — catch로 기존 동작(기본 컨텍스트) 폴백, 최악의 경우도 "지금과 동일"이라 회귀 아님.
- `main.tsx`에서 `createRoot().render()` 전에 동기 호출하므로 React 컴포넌트·이펙트는 하나도 안 돌았을 시점 — 위에서 나열한 네 곳(트랙 풀/드럼 보이스/스코어 플레이어·메트로놈·클록의 Transport) 전부보다 이르다는 게 보장됨(위 "어디서 설정하나" 절의 import-그래프 분석 참고). 서드파티 의존성 내부에서 Tone을 건드리는 경우는 grep으로 못 잡으므로 단정하지 않음 — 구현 후 타임스탬프 로그로 재확인(위 참고).
- **(Codex 모드C 1차 C-004 반영)** "AudioContext를 사용자 제스처 전에 미리 만들면 이후 언락(unlock) 흐름이 깨지지 않을까" 우려가 있었으나, 설치된 Tone.js 소스(`Tone/core/Global.ts`)를 직접 확인한 결과 `setContext()`는 넘겨받은 네이티브 컨텍스트를 감싸 전역으로 지정할 뿐 기존 언락 로직과 독립적이고, 실제 언락은 여전히 사용자 제스처 핸들러 안에서 호출되는 `drumVoices.ts`의 `await Tone.start()`와 `trackPlayer.ts`의 `pool.prime()`(play-then-pause 트릭)가 그대로 담당한다 — 조기 생성 자체가 언락을 망가뜨린다는 근거는 코드상 없음. 다만 이건 코드 근거일 뿐 실기기 확인은 아직 아님 — **구현 후 아이폰에서 "새로고침 → 재생 버튼 최초 탭 → 소리가 바로 나오는지"를 반드시 재확인**(지금까지의 T6-4 실험은 전부 이미 재생 중이던 상태에서 콘솔로 트랙을 조작한 것이라 "최초 언락" 경로 자체는 아직 이 변경과 함께 실측된 적이 없음).
- **(Codex 모드C 1차 C-005 반영)** 44100Hz 선택은 **현재 서버 인코딩 설정(44100Hz, `-ar` 미지정 Demucs 기본값) 기준의 회귀 수정**이지 "iOS가 44100을 선호한다"는 일반 법칙이 아니다 — 48000Hz 출력물을 48000Hz 컨텍스트로 맞췄을 때도 똑같이 빨라지는지는 테스트하지 않았음(둘 다 리샘플링 없이 일치시키면 될 거라 추정은 자연스럽지만 확정 아님). 서버 인코딩 레이트를 나중에 바꾸는 일이 생기면, 그때는 이 44100 상수도 실기기로 재검증 필요.
