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
  /** 주기적 호출 — 기대 위치와 실제 위치가 thresholdSeconds를 넘게 벌어지면
   * currentTime을 보정(루프 경계의 큰 점프 교정용 — work/T3-3/plan.md §5,
   * threshold는 ±30ms보다 느슨하게 둬서 고정 지연을 상시 재보정하지 않음). */
  resync(expectedSongPositionSeconds: number, playbackRate: number, thresholdSeconds: number): void
  stop(): void
  dispose(): void
}

export function createTrackPlayer(sources: TrackSource[]): TrackPlayer {
  const tracks: TrackState[] = sources.map((source) => {
    const element = new Audio(source.url)
    element.preload = 'auto'
    return { kind: source.kind, element, unlocked: false }
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
      void track.element.play().catch(() => {
        // 재생 도중 거부되면(드물게 발생 가능) 이번 세션 동안 이 트랙만 계속
        // 건너뛴다 — 위 prime()과 같은 "조용히 무시하지 않되 전체를 막지도
        // 않는다" 원칙.
        track.unlocked = false
      })
    }
  }

  function resync(
    expectedSongPositionSeconds: number,
    playbackRate: number,
    thresholdSeconds: number,
  ): void {
    for (const track of tracks) {
      if (!track.unlocked || track.element.paused) continue
      const actualSongPositionSeconds = track.element.currentTime * playbackRate
      const driftSeconds = Math.abs(actualSongPositionSeconds - expectedSongPositionSeconds)
      if (driftSeconds > thresholdSeconds) {
        track.element.currentTime = Math.max(0, expectedSongPositionSeconds)
      }
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

  return { prime, playFrom, resync, stop, dispose }
}
