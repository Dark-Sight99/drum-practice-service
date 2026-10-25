// T3-3(REQ-04) — 분리된 오디오 트랙(T3-1 스템) 재생. Tone.js를 모르는 순수
// HTMLAudioElement 래퍼(책임 분리 — clock.ts/drumVoices.ts와 같은 "작은 책임"
// 모듈 원칙, work/T3-3/plan.md §3). Transport 스케줄링은 scorePlayer.ts가 맡는다.

export interface TrackSource {
  kind: string
  url: string
}

interface TrackState {
  kind: string
  element: HTMLAudioElement
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
   * 그대로 적용. `<audio>`의 `.volume`은 네이티브 0~1 선형이라 변환 불필요
   * — 이 모듈은 mute/solo 개념을 모른다(책임 분리, work/T3-4/plan.md §3).
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
  const tracks: TrackState[] = sources.map((source) => {
    const element = new Audio(source.url)
    element.preload = 'auto'
    return { kind: source.kind, element, unlocked: false, started: false }
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
    track.element.volume = Math.min(1, Math.max(0, gain))
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
    }
  }

  return { prime, playFrom, resync, setChannelGain, pause, resume, stop, dispose }
}
