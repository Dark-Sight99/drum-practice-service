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
  unlocked: boolean
  // T3-6(REQ-04, 모드A 지적 반영) — playFrom()이 이 트랙을 실제로 재생
  // 시작했는지. unlocked는 prime() 성공 여부만 나타내 "카운트인 중 일시정지
  // →재개"처럼 playFrom()이 아직 한 번도 안 불린 트랙까지 resume()이 조기
  // 재생시키는 버그가 있었음(원곡 오디오가 카운트인이 끝나기 전에 먼저
  // 들림) — started로 "이번 세션에서 실제로 시작된 적 있는지"를 따로 추적.
  started: boolean
}

export interface TrackPlayer {
  /** 사용자 제스처(클릭) 핸들러 안에서 호출 — 각 엘리먼트를 play()했다가 즉시
   * pause()해 모바일 자동재생 정책의 "제스처로 인정" 상태를 만들어둔다(이후
   * Transport 콜백에서의 비동기 play()가 거부되지 않도록). 성공/실패는
   * `unlocked` 상태로 트랙 수명(이 TrackPlayer 인스턴스) 동안 고정 보관 —
   * `playFrom`이 매번(루프 재진입 포함) 이 상태를 다시 확인해 실패한 트랙은
   * 재시도 없이 계속 건너뛴다(work/T3-3/plan.md §3 — 제스처 밖 재시도는 같은
   * 이유로 다시 거부될 뿐). */
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
  dispose(): void
}

export function createTrackPlayer(sources: TrackSource[]): TrackPlayer {
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
  // setChannelGain()/dispose()가 이를 감지해 element.volume으로 대신 제어.
  const useWebAudioForVolume = isIOS()
  const tracks: TrackState[] = sources.map((source) => {
    const element = new Audio(source.url)
    element.preload = 'auto'
    if (!useWebAudioForVolume) {
      return {
        kind: source.kind,
        element,
        sourceNode: null,
        gainNode: null,
        unlocked: false,
        started: false,
      }
    }
    const sourceNode = context.createMediaElementSource(element)
    const gainNode = context.createGain()
    sourceNode.connect(gainNode)
    gainNode.connect(context.destination)
    return { kind: source.kind, element, sourceNode, gainNode, unlocked: false, started: false }
  })

  async function prime(): Promise<{ kind: string; ok: boolean }[]> {
    return Promise.all(
      tracks.map(async (track) => {
        try {
          await track.element.play()
          track.element.pause()
          track.element.currentTime = 0
          track.unlocked = true
        } catch {
          track.unlocked = false
        }
        return { kind: track.kind, ok: track.unlocked }
      }),
    )
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
        // 없는 트랙이 생기지 않는다.
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
    // T3-16-feedback-3(진단용, 임시) — gainNode가 null인 트랙(위
    // DIAG_SKIP_WEBAUDIO_FOR)은 element.volume으로 대신 적용(이 맥 진단
    // 테스트 중엔 음량이 정확하지 않아도 무방 — 드리프트 로그만 본다).
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

  function dispose(): void {
    for (const track of tracks) {
      track.element.pause()
      track.element.src = ''
      // T3-12 — Web Audio 그래프 연결 해제(메모리 누수 방지, Tone 노드가
      // 아닌 네이티브 노드라 `.dispose()`가 아니라 `.disconnect()`).
      // T3-16-feedback-3(진단용, 임시) — DIAG_SKIP_WEBAUDIO_FOR 트랙은 애초에
      // 두 노드가 없음(null).
      track.gainNode?.disconnect()
      track.sourceNode?.disconnect()
    }
  }

  return { prime, playFrom, seekTo, resync, setChannelGain, pause, resume, stop, dispose }
}
