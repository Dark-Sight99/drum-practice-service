// T3-3(REQ-04) — 분리된 오디오 트랙(T3-1 스템) 재생. 원래는 Tone.js를 모르는
// 순수 HTMLAudioElement 래퍼였음(책임 분리 — clock.ts/drumVoices.ts와 같은
// "작은 책임" 모듈 원칙, work/T3-3/plan.md §3). Transport 스케줄링은
// scorePlayer.ts가 맡는다.
// T3-12(2026-10-25, 의뢰인 피드백 "모바일 믹서 수치 변경해도 적용 안됨 — UI는
// 바뀌는데 실제 소리는 안 바뀜, PC는 정상") — iOS(모든 iOS 브라우저는 WebKit
// 기반)는 `HTMLMediaElement.volume`을 JS로 설정해도 실제 출력 음량에 반영하지
// 않는다(Apple 공식 문서: "The volume property is not settable in JavaScript.
// Reading the volume property always returns 1." — WebKit 소스에도 이를
// 강제하는 코드가 있었음, 2022년에야 플랫폼별 플래그로 정리됨). 그래서 이
// 모듈도 Web Audio API로 옮겨 `GainNode.gain`으로 음량을 조절했음(Tone.js가
// synth_drums/metronome에 이미 쓰는 것과 같은 방식).
//
// T3-16-feedback-3(2026-10-26, 의뢰인 피드백 "맥에서 음악이 0.5초마다 끊김") —
// 그런데 T3-12 당시엔 **아이폰에서만** 이 버그를 확인했지, 맥(데스크톱
// 사파리)까지 같은 버그가 있는지는 확인한 적이 없었다. 실측해보니(resync()의
// drift 로그 + 맥에서 직접 청취) 맥에서는 반대로 **Web Audio로 우회한 트랙만
// 실시간보다 느리게 재생**돼 0.5초 안팎으로 소리가 끊기는 걸 확인 — 격리
// 테스트(Web Audio만 뺀 트랙은 드리프트가 사라짐, preservesPitch는 무관함을
// 확인)로 원인이 Web Audio 우회 자체임을 좁혔다. 이건 우리만의 특이 현상이
// 아니라 같은 구조(스템 여러 개를 MediaElementAudioSourceNode로 재생)의 다른
// 오픈소스 프로젝트(stemdeckapp/stemdeck)도 겪고 결국 Web Audio를 걷어내고
// `element.volume`으로 되돌려 고친 사례가 있음(stemdeckapp/stemdeck#38,
// "createMediaElementSource()가 Safari 네이티브 출력 경로를 깨뜨린다").
//
// 그래서 **iOS에서만** Web Audio(GainNode) 경로를 쓰고, 그 외(맥·윈도우 등
// 데스크톱)는 원래의 `element.volume` 직접 제어로 되돌린다 — 아이폰 볼륨
// 버그도 여전히 고쳐진 채로, 맥의 재생 지연 문제도 없앤다.
//
// T3-16-feedback-6(2026-10-26, work/T3-16-feedback-6/plan.md, 모드C 3라운드
// 검수 완료) — 재생 버튼을 누를 때마다 `createTrackPlayer()`가 `<audio>`
// 엘리먼트를 새로 만들고 `stopPlayback()`이 매번 버려서(`element.src=''`),
// 맥 네트워크 탭 실측 결과 재생 세션마다 4개 스템 전체를 처음부터 다시
// 받고 있었음(프리페치 캐시가 재생 엘리먼트에 공유 안 됨, Q-35). 엘리먼트
// (+iOS 전용 Web Audio 와이어링)의 소유권을 "재생 세션"에서 "연습 화면이
// 떠 있는 동안"(`AudioTrackPool`)으로 옮겨, 같은 화면에서 재생을 몇 번
// 반복해도 엘리먼트를 재사용(= 네트워크 재다운로드 없음)하게 한다.
// `TrackPlayer`는 이제 풀을 받아 세션 범위 동작만 구현하는 얇은 래퍼.
import * as Tone from 'tone'

/** T3-16-feedback-3 — iPhone/iPod/iPad는 보통 UA에 그대로 찍히지만(일부
 * 설정·구버전 iPadOS는 "iPad"가 그대로 남음), iPadOS 13+ 기본값은 데스크톱
 * Safari와 똑같은 UA("Macintosh")를 보내 UA만으론 못 가른다 — 모드A 지적
 * (2026-10-26, C-001): 처음엔 "iPad" 리터럴 자체를 안 보고 "Macintosh+터치"
 * 폴백에만 의존해서, UA에 "iPad"가 남아있는 기기를 놓치고 있었음. 두
 * 가지를 OR로 합쳐 둘 다 잡는다(iPadOS 13+ 위장은 멀티터치로 구분 — Mac은
 * `maxTouchPoints` 0~1). */
function isIOS(): boolean {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1
}

export interface TrackSource {
  kind: string
  url: string
}

interface TrackState {
  kind: string
  element: HTMLAudioElement
  /** T3-12 — `element`의 디코딩된 출력을 Web Audio 그래프로 연결하는 소스
   * 노드. 한 번 연결되면 그 뒤로 `element`의 소리는 이 노드를 거쳐야만
   * 들린다(스펙 동작) — `gainNode`가 항상 destination에 연결돼 있어야 함.
   * T3-16-feedback-3 — iOS가 아니면 애초에 안 만듦(null, 아래
   * `useWebAudioForVolume` 참고). */
  sourceNode: MediaElementAudioSourceNode | null
  /** T3-12 — 음량 제어 지점(이전엔 `element.volume`이었음, iOS에서 무시됨).
   * T3-16-feedback-3 — null이면(데스크톱) Web Audio를 거치지 않고
   * element.volume으로 직접 제어(`setChannelGain()` 참고). */
  gainNode: GainNode | null
  /** T3-16-feedback-6 — **풀(`AudioTrackPool`) 스코프 상태**: 이 엘리먼트가
   * 프로그램적 `play()`를 허락받았는지. 한 번 `true`가 되면 풀이 살아있는
   * 동안(여러 재생 세션에 걸쳐) 계속 `true` — "한 번 사용자 제스처 안에서
   * 성공한 play()는 그 엘리먼트 수명 동안 계속 블레스된 상태로 유지된다"는
   * 표준 동작을 근거로, 세션마다 다시 prime()하지 않는다(`pool.prime()`
   * 참고). 다만 이 가정이 깨져 나중 세션에서 `play()`가 실제로 거부되면
   * `playFrom()`/`resume()`의 catch가 이 값을 다시 `false`로 내리고, 그러면
   * 다음 `pool.prime()`이 "이미 unlocked면 생략" 조건이 더 이상 성립하지
   * 않아 자동으로 재언락을 시도한다(별도 동기화 코드 불필요 — 이 트랙 객체
   * 자체를 풀과 세션이 참조로 공유하기 때문, `createAudioTrackPool()` 참고).
   * 트랙마다 독립 — 스템 중 하나만 언락 실패해도 나머지는 영향 없음. */
  unlocked: boolean
  /** T3-16-feedback-6 — **세션 스코프 상태**(위 `unlocked`와 레벨이 다름):
   * 이번 재생 세션에서 `playFrom()`이 실제로 이 트랙을 시작시켰는지.
   * `unlocked`는 prime() 성공 여부(풀 수명 전체)만 나타내 "카운트인 중
   * 일시정지→재개"처럼 playFrom()이 아직 한 번도 안 불린 트랙까지
   * resume()이 조기 재생시키는 버그가 있었음(T3-6 모드A 지적) — started로
   * "이번 세션에서 실제로 시작된 적 있는지"를 따로 추적. 엘리먼트 객체는
   * 세션을 넘어 재사용되지만, 이 필드는 **세션이 새로 시작할 때마다
   * `reset()`으로 명시적으로 `false`로 되돌아가야 한다**(아래 `reset()`
   * 참고 — 안 그러면 이전 세션의 "시작됨" 기록이 다음 세션에 새서 resume()
   * 조기 재생 버그가 재발함). */
  started: boolean
}

/** T3-16-feedback-6 — `<audio>` 엘리먼트(+iOS 전용 Web Audio 와이어링)를
 * "연습 화면이 이 곡을 보여주는 동안" 단위로 소유한다. `createMediaElementSource()`는
 * 스펙상 엘리먼트당 평생 한 번만 부를 수 있어(두 번째 호출은 InvalidStateError),
 * 여러 재생 세션(`TrackPlayer`)에 걸쳐 엘리먼트를 재사용하려면 이 와이어링도
 * 세션이 아니라 풀이 한 번만 하고 계속 들고 있어야 한다. */
export interface AudioTrackPool {
  /** 이 풀이 들고 있는 트랙들(읽기 전용 — 세션은 이 배열의 객체를 직접
   * 참조해서 읽고 쓴다, 복사하지 않음. `unlocked` 같은 풀 스코프 필드가
   * 세션의 쓰기로 바로 갱신되게 하는 핵심 — "트랙별 독립, 객체 참조 공유로
   * 자동 동기화", work/T3-16-feedback-6/plan.md 모드C 3라운드 C-007). */
  readonly tracks: readonly TrackState[]
  /** 모든 트랙을 언락 시도(성공한 트랙은 캐시돼 재시도 없이 즉시 반환 —
   * 세션마다 다시 불러도 안전·저렴하다는 게 핵심 설계, 아래 구현 참고).
   * 진행 중인 호출이 있으면 같은 Promise를 공유(중복 play()/pause() 방지). */
  prime(): Promise<{ kind: string; ok: boolean }[]>
  /** 풀 자체를 파괴 — 모든 엘리먼트를 멈추고 Web Audio 노드를 끊고
   * `src`를 비운다. 연습 화면을 벗어나거나(언마운트) 곡이 바뀔 때만
   * 호출(세션이 끝날 때마다가 아님 — 그건 `TrackPlayer.reset()`). */
  destroy(): void
}

export function createAudioTrackPool(sources: TrackSource[]): AudioTrackPool {
  // T3-12 — Tone.js가 synth_drums/metronome에 이미 쓰고 있는 것과 같은
  // AudioContext를 공유(실제 설치된 Tone.js 15.1.22 타입 선언으로
  // `Context.rawContext`가 네이티브 `AudioContext`를 돌려줌을 확인) — 이
  // context는 `createDrumVoices()`의 `Tone.start()`가 같은 사용자 제스처
  // 흐름(handlePlay()) 안에서 이미 resume시키므로 별도 unlock 로직이 필요
  // 없다. `createMediaElementSource()`는 context가 suspended 상태여도 그래프
  // 구성 자체는 바로 되고, 실제로 소리가 나는 시점(훨씬 뒤, Transport가
  // playFrom()을 트리거할 때)엔 이미 resume된 뒤다.
  const context = Tone.getContext().rawContext as unknown as AudioContext
  // T3-16-feedback-3 — iOS에서만 Web Audio(GainNode) 경로를 쓴다(위 모듈
  // 상단 주석 참고). 데스크톱은 sourceNode/gainNode가 null이고
  // setChannelGain()/destroy()가 이를 감지해 element.volume으로 대신 제어.
  // 풀 생성(화면 진입) 시점에 한 번만 판별 — 화면을 보는 도중 플랫폼이
  // 바뀔 리 없으므로 세션마다 다시 판별할 필요 없음(모드C 1라운드 확인).
  const useWebAudioForVolume = isIOS()

  // 모드C 3라운드 지적(Medium, C-008) — 트랙 생성 도중 하나라도 던지면(예:
  // Web Audio 노드 생성 실패) 그때까지 만든 트랙만 정리(일시정지·노드
  // disconnect·src 비움)하고 다시 던진다 — 호출자(PracticeCanvas.tsx)가
  // 실패를 알아야 하고, 일부만 만들어진 채 새는 리소스가 없어야 한다.
  const tracks: TrackState[] = []
  try {
    for (const source of sources) {
      const element = new Audio(source.url)
      element.preload = 'auto'
      if (!useWebAudioForVolume) {
        tracks.push({
          kind: source.kind,
          element,
          sourceNode: null,
          gainNode: null,
          unlocked: false,
          started: false,
        })
        continue
      }
      // 모드A 지적(필수, 반영함) — 이 트랙 자체(createMediaElementSource는
      // 성공했는데 createGain()/connect()가 실패하는 경우 등)가 완성되기
      // 전에 던지면, 아직 `tracks.push()` 전이라 바깥 catch의 정리 루프가
      // 이 트랙을 못 본다 — element·부분적으로 만들어진 sourceNode가 그대로
      // 샌다. 트랙 하나 단위로 즉시 정리하고 다시 던져서, 바깥 catch는
      // "이전까지 이미 완성된 트랙들"만 정리하면 되게 한다.
      let sourceNode: MediaElementAudioSourceNode | null = null
      try {
        sourceNode = context.createMediaElementSource(element)
        const gainNode = context.createGain()
        sourceNode.connect(gainNode)
        gainNode.connect(context.destination)
        tracks.push({ kind: source.kind, element, sourceNode, gainNode, unlocked: false, started: false })
      } catch (err) {
        try {
          element.pause()
        } catch {
          /* 무시 */
        }
        try {
          sourceNode?.disconnect()
        } catch {
          /* 무시 */
        }
        try {
          element.src = ''
        } catch {
          /* 무시 */
        }
        throw err
      }
    }
  } catch (err) {
    for (const track of tracks) {
      destroyTrack(track)
    }
    throw err
  }

  let destroyed = false
  // T3-16-feedback-6(모드C 1라운드 C-001 반영) — 진행 중인 prime() 호출을
  // 공유해 중복 play()/pause()를 막는다(예: 재생 버튼을 빠르게 두 번 누름).
  let primePromise: Promise<{ kind: string; ok: boolean }[]> | null = null

  async function prime(): Promise<{ kind: string; ok: boolean }[]> {
    if (primePromise) return primePromise
    primePromise = Promise.all(
      tracks.map(async (track) => {
        // 이미 언락된 트랙은 재시도 없이 즉시 반환 — "한 번 블레스되면 그
        // 엘리먼트 수명 동안 유지"가 핵심 설계(모드C 1라운드 C-001, 2라운드
        // C-006). 실패로 되돌아간(unlocked=false) 트랙만 다시 play()+pause()
        // 트릭을 시도.
        if (track.unlocked) return { kind: track.kind, ok: true }
        try {
          await track.element.play()
          track.element.pause()
          track.element.currentTime = 0
          if (!destroyed) track.unlocked = true
        } catch {
          if (!destroyed) track.unlocked = false
        }
        return { kind: track.kind, ok: track.unlocked }
      }),
    )
    try {
      return await primePromise
    } finally {
      primePromise = null
    }
  }

  function destroyTrack(track: TrackState): void {
    // 모드C 3라운드 지적(Medium, C-008 재사용) — 트랙 하나 정리가 실패해도
    // (예: currentTime 대입이 미디어 준비 전이라 던짐) 나머지 트랙 정리가
    // 막히지 않게 트랙마다 독립적으로 감싼다.
    try {
      track.element.pause()
    } catch {
      /* 무시 — 다음 정리 단계는 계속 진행 */
    }
    try {
      track.gainNode?.disconnect()
    } catch {
      /* 무시 */
    }
    try {
      track.sourceNode?.disconnect()
    } catch {
      /* 무시 */
    }
    try {
      track.element.src = ''
    } catch {
      /* 무시 */
    }
  }

  function destroy(): void {
    destroyed = true
    for (const track of tracks) {
      destroyTrack(track)
    }
  }

  return { tracks, prime, destroy }
}

export interface TrackPlayer {
  /** 사용자 제스처(클릭) 핸들러 안에서 호출 — 각 엘리먼트를 play()했다가 즉시
   * pause()해 모바일 자동재생 정책의 "제스처로 인정" 상태를 만들어둔다(이후
   * Transport 콜백에서의 비동기 play()가 거부되지 않도록). `AudioTrackPool.prime()`에
   * 위임하는 얇은 래퍼 — 이미 언락된 트랙은 즉시 반환되므로 두 번째 세션부터는
   * 사실상 공짜(work/T3-16-feedback-6/plan.md). */
  prime(): Promise<{ kind: string; ok: boolean }[]>
  /** 곡 내 위치(초, 원곡 기준)로 각 트랙(언락 성공한 것만)을 이동시키고 재생
   * 시작. preservesPitch=true + playbackRate 설정. */
  playFrom(songPositionSeconds: number, playbackRate: number): void
  /** T3-9(REQ-04) — `playFrom()`과 달리 **재생을 시작하지 않고** 위치만
   * 옮긴다(`.play()` 호출 없음). 일시정지 중 탐색(seek)처럼 "지금은 소리가
   * 나면 안 되지만 다음에 재생을 누르면 이 위치부터 이어가야 하는" 경우에
   * 씀 — `playFrom()`을 그대로 쓰면 Transport·신스 드럼은 멈춰있는데
   * 분리 트랙만 다시 들리는 모순이 생김(모드C 3라운드 C-008 지적). */
  seekTo(songPositionSeconds: number, playbackRate: number): void
  /** 주기적 호출 — 기대 위치(원곡 파일 기준 초, `audioTrackPositionSeconds`와
   * 같은 단위)와 실제 위치(`currentTime`, 이미 원곡 파일 기준 초)가
   * thresholdSeconds를 넘게 벌어지면 currentTime을 보정(루프 경계의 큰 점프
   * 교정용 — work/T3-3/plan.md §5, threshold는 ±30ms보다 느슨하게 둬서 고정
   * 지연을 상시 재보정하지 않음). 모드A 지적(Medium) 반영: `currentTime`은
   * 이미 원곡 파일 기준 초라 playbackRate를 또 곱하면 안 됨(1배속이 아닐 때
   * 비교 단위가 안 맞아 매번 잘못 보정하는 버그였음) — 그래서 playbackRate를
   * 받지 않는다. */
  resync(expectedSongPositionSeconds: number, thresholdSeconds: number): void
  /** T3-4(REQ-05) — 믹서가 mute/solo까지 반영해 계산한 "최종 게인"(0~1)을
   * 그대로 적용(T3-12부터 GainNode 기반 — 선형 0~1 단위라 변환 불필요는
   * 그대로 유지). 이 모듈은 mute/solo 개념을 모른다(책임 분리, work/T3-4/plan.md §3).
   * `kind`가 이 플레이어에 없으면 조용히 무시(다른 트랙 종류가 아직 분리
   * 안 된 곡 등 — 호출자가 존재 여부를 매번 확인할 필요 없게). */
  setChannelGain(kind: string, gain: number): void
  /** T3-6(REQ-04) — 언락된 트랙만 .pause()(HTMLMediaElement 네이티브 —
   * currentTime은 그대로 보존됨, 스펙 보장). resync()는 이미
   * `track.element.paused`를 건너뛰는 가드가 있어 수정 불필요. */
  pause(): void
  /** T3-6(REQ-04) — 언락되고 **이미 playFrom()으로 실제 시작된** 트랙만
   * .play() 재호출(모드A 지적 반영 — 카운트인 중 일시정지처럼 아직 한 번도
   * 시작 안 된 트랙까지 여기서 조기 재생하면 카운트인이 끝나기 전에 원곡
   * 오디오가 먼저 들리는 버그가 됨. 그런 트랙은 Transport가 재개돼 원래
   * 예약된 playFrom() 콜백이 때가 되면 알아서 시작시킨다). 이미 한 번
   * 사용자 제스처 안에서 성공적으로 재생된 엘리먼트는 이후 play()가
   * "블레스"된 상태로 유지되는 게 표준 동작이라 추가 제스처 없이 재생 가능. */
  resume(): void
  stop(): void
  /** T3-16-feedback-6(T3-12의 `dispose()`를 대체) — 엘리먼트를 파괴하지
   * **않는다**(그건 `AudioTrackPool.destroy()`의 몫). 이번 세션만 정리:
   * 일시정지 + `currentTime=0` + `started`만 `false`로 되돌림. `unlocked`는
   * 풀 스코프라 안 건드림(모드C 2라운드 C-005 지적 반영 — 세션 정리와
   * "언락 상태 유지"가 섞이면 안 됨). */
  reset(): void
}

export function createTrackPlayer(pool: AudioTrackPool): TrackPlayer {
  const tracks = pool.tracks

  function prime(): Promise<{ kind: string; ok: boolean }[]> {
    return pool.prime()
  }

  function playFrom(songPositionSeconds: number, playbackRate: number): void {
    for (const track of tracks) {
      if (!track.unlocked) continue
      track.element.preservesPitch = true
      track.element.playbackRate = playbackRate
      track.element.currentTime = Math.max(0, songPositionSeconds)
      track.started = true
      void track.element.play().catch(() => {
        // 재생 도중 거부되면(드물게 발생 가능) 이번 세션 동안 이 트랙만 계속
        // 건너뛴다 — 위 prime()과 같은 "조용히 무시하지 않되 전체를 막지도
        // 않는다" 원칙. T3-6 모드A 2라운드 지적(High) — 루프 재진입처럼 이
        // 호출 시점에 엘리먼트가 이미 재생 중이었을 수 있어(직전 루프 구간의
        // 소리), 거부돼도 재생이 그대로 이어질 수 있다. unlocked=false가 된
        // 트랙은 이후 pause()/resume()이 전부 건너뛰므로, 여기서 명시적으로
        // pause()해 "unlocked=false ⇒ 소리 안 남"을 보장해야 pause()로 끌 수
        // 없는 트랙이 생기지 않는다. T3-16-feedback-6 — unlocked가 풀
        // 스코프로 바뀌었어도 이 재설정은 그대로 유효: 다음 세션의
        // pool.prime()이 "이미 unlocked면 생략" 조건이 깨져 자동 재언락을
        // 시도하게 된다(모드C 2라운드 C-006).
        track.unlocked = false
        track.element.pause()
      })
    }
  }

  function seekTo(songPositionSeconds: number, playbackRate: number): void {
    for (const track of tracks) {
      if (!track.unlocked) continue
      track.element.preservesPitch = true
      track.element.playbackRate = playbackRate
      track.element.currentTime = Math.max(0, songPositionSeconds)
      // .play()를 안 부름 — playFrom()과의 유일한 차이(일시정지 상태 유지).
    }
  }

  function resync(expectedSongPositionSeconds: number, thresholdSeconds: number): void {
    for (const track of tracks) {
      if (!track.unlocked || track.element.paused) continue
      const actualSongPositionSeconds = track.element.currentTime
      const driftSeconds = Math.abs(actualSongPositionSeconds - expectedSongPositionSeconds)
      if (driftSeconds > thresholdSeconds) {
        track.element.currentTime = Math.max(0, expectedSongPositionSeconds)
      }
    }
  }

  function setChannelGain(kind: string, gain: number): void {
    const track = tracks.find((t) => t.kind === kind)
    if (!track) return
    // T3-12 — 이전엔 `track.element.volume`(iOS에서 무시됨)이었음. GainNode는
    // Tone.js의 synth_drums/metronome 게인과 같은 선형(0~1) 단위라 변환 불필요.
    // T3-16-feedback-3 — gainNode가 null인 트랙(데스크톱)은 element.volume으로
    // 대신 적용.
    if (track.gainNode) {
      track.gainNode.gain.value = Math.min(1, Math.max(0, gain))
    } else {
      track.element.volume = Math.min(1, Math.max(0, gain))
    }
  }

  function pause(): void {
    for (const track of tracks) {
      if (!track.unlocked) continue
      track.element.pause()
    }
  }

  function resume(): void {
    for (const track of tracks) {
      // T3-6 모드A 지적(High) — started가 false면(카운트인 중 일시정지처럼
      // playFrom()이 아직 한 번도 안 불린 경우) 여기서 재생하지 않는다 —
      // Transport가 재개돼 원래 예약된 playFrom() 콜백이 때가 되면 알아서
      // 시작시킨다(기존 T2-4/T3-3에서 이미 검증된 경로). 여기서 조기에 play()
      // 하면 카운트인이 끝나기도 전에 원곡 오디오가 먼저 들리는 버그가 된다.
      if (!track.unlocked || !track.started) continue
      void track.element.play().catch(() => {
        // T3-6 모드A 2라운드 지적(High) — playFrom()의 catch와 같은 이유로
        // 명시적 pause() 추가(위 playFrom() 주석 참고).
        track.unlocked = false
        track.element.pause()
      })
    }
  }

  function stop(): void {
    for (const track of tracks) {
      track.element.pause()
      track.element.currentTime = 0
    }
  }

  function reset(): void {
    for (const track of tracks) {
      // 모드C 3라운드 패턴 재사용(C-008) — 트랙 하나가 실패해도 나머지는
      // 계속 정리.
      try {
        track.element.pause()
        track.element.currentTime = 0
      } catch {
        /* 무시 — 다음 트랙 계속 */
      }
      track.started = false
      // unlocked는 의도적으로 안 건드림 — 풀 스코프(모드C 2라운드 C-005).
    }
  }

  return { prime, playFrom, seekTo, resync, setChannelGain, pause, resume, stop, reset }
}
