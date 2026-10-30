// T6-11(REQ-04/06, Q-33, work/T6-11/plan.md) — stemSchedule.ts의 순수 계산을
// 실제 Tone.js 객체(Tone.Player/Tone.Transport)에 연결하는 모듈. `trackPlayer.ts`
// (`<audio>`+`createMediaElementSource()` 기반)를 대체하는 새 경로 — 아직
// `scorePlayer.ts`/`PracticeCanvas.tsx`에 연결 안 함(Step 1, 이 파일 자체의
// 단위 테스트만 통과하면 됨). 연결은 Step 2에서.
import * as Tone from 'tone'
import { linearGainToDb } from './mixer'
import { planStemStart, stemNodePlaybackRate, type StemSessionTiming } from './stemSchedule'

export interface StemSource {
  kind: string
  url: string
}

interface StemTrack {
  kind: string
  player: Tone.Player
  bufferDurationSeconds: number
}

/** 연습 화면이 이 곡(+이 배속 변환본)을 보여주는 동안 소유하는 버퍼 풀
 * (`trackPlayer.ts`의 `AudioTrackPool`과 같은 수명 원칙 — T3-16-feedback-6). */
export interface StemBufferPool {
  readonly kinds: readonly string[]
  /** 이 풀의 버퍼가 렌더된 배속(서버 변환본이면 그 배속의 permille/1000,
   * 원본 그대로면 1 — stemSchedule.ts의 `bufferTempoRatio`와 같은 의미). */
  readonly bufferTempoRatio: number
  readonly destroyed: boolean
  destroy(): void
  /** @internal createStemPlayer() 전용 — 외부에서 직접 읽지 않음. */
  readonly tracks: readonly StemTrack[]
}

/** 한 재생 세션(`trackPlayer.ts`의 `TrackPlayer`를 대체). `resync()`에 해당하는
 * 개념 자체가 없다 — Transport 이벤트를 구독해 스스로 따라가므로 호출자가
 * 매 프레임 위치를 맞춰줄 필요가 없다(work/T6-11/plan.md "resync()는 완전히
 * 없앤다" 참고). */
export interface StemPlayer {
  /** `scorePlayer.ts`의 `playDrumScore()`가 `transport.start()` 직전에 1회
   * 호출. Transport 이벤트 구독 + 세션 상태(카운트인 게이트 등) 초기화.
   * 이미 attach된 상태에서 다시 부르면 이전 세션을 먼저 정리한다(멱등). */
  attach(timing: StemSessionTiming): void
  /** 이벤트 구독 해제 + 즉시 정지. 여러 번 불러도 안전. */
  detach(): void
  /** T6-11 Step 2(Codex 모드C 1차 C-005 반영) — Transport의 `start`/`loopStart`
   * 이벤트는 "그 네이티브 메커니즘이 스스로 위치를 바꾸는 순간"에만 발화한다.
   * `PracticeCanvas.tsx`의 빨리감기/되감기(`handleSeek`)나 편집 화면에서 넘어온
   * 핸드오프처럼, 호출자가 `transport.seconds = X`를 **직접** 대입해 Transport
   * 모르게 위치를 점프시키는 경우(`clock.setPositionSeconds()`, work/T6-11/
   * plan.md "A-B 루프 구간 변경" 참고)엔 그 이벤트가 전혀 안 뜬다 — 그 직후
   * 호출자가 명시적으로 이걸 불러야 지금 Transport 위치 기준으로 다시 계산해
   * 재시작한다. (반대로 A-B 구간의 "값"만 바꾸고(`setLoopPoints`) 현재 위치는
   * 안 건드리는 경우는 호출 불필요 — Transport가 다음 루프 경계에서 스스로
   * `loopStart`를 발화해 이미 올바르게 처리됨, 위 plan.md 참고.) 일시정지
   * 중에는 호출하면 안 된다(소리가 의도치 않게 다시 시작됨) — 호출자가
   * `isPaused`로 가드. 폴링이 아니라 "위치가 바뀐 바로 그 시점에 1회"만 부르는
   * 것이므로 옛 `resync()`의 상시 폴링과는 다르다. */
  restartFromCurrentPosition(): void
  /** 믹서 최종 게인(0~1, mute/solo까지 반영된 값). 없는 kind는 조용히 무시
   * (기존 `trackPlayer.ts`와 같은 계약 — stem_music이 없는 곡 등). */
  setChannelGain(kind: string, gain: number): void
}

/** 재시작·정지 시 클릭(딸깍) 방지용 짧은 크로스페이드. 실측(청취)으로 더
 * 조정될 수 있음(work/T6-11/plan.md "확인 필요" 목록). */
const STEM_FADE_SECONDS = 0.005

function destroyTrack(track: StemTrack): void {
  try {
    track.player.dispose()
  } catch {
    /* 무시 — 다른 트랙 정리는 계속 진행(기존 destroyTrack 패턴 재사용) */
  }
}

/** 스템 소스를 전부 fetch → decodeAudioData → `Tone.Player`로 만든다.
 * `trackPlayer.ts`의 `createAudioTrackPool()`과 같은 실패 처리 원칙
 * (Promise.allSettled로 전부 기다린 뒤 하나라도 실패하면 전부 정리하고 재던짐 —
 * 모드C 지적 C-001 패턴 재사용)이지만, 디코딩 자체는 **순차**로 한다(동시
 * 디코딩의 순간 메모리 피크를 줄이려는 의도 — work/T6-11/plan.md "로딩 전략"). */
export async function loadStemBufferPool(
  sources: StemSource[],
  options: { bufferTempoRatio: number; signal?: AbortSignal },
): Promise<StemBufferPool> {
  const context = Tone.getContext()

  const fetched = await Promise.allSettled(
    sources.map(async (source) => {
      const response = await fetch(source.url, { signal: options.signal })
      if (!response.ok) {
        throw new Error(`스템을 받지 못함(${source.kind}): HTTP ${response.status}`)
      }
      const bytes = await response.arrayBuffer()
      return { kind: source.kind, bytes }
    }),
  )
  const firstError = fetched.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  )
  if (firstError) {
    // 아직 디코딩 전(Tone.Player·Web Audio 노드 생성 전)이라 정리할 노드가 없음 —
    // ArrayBuffer는 참조를 안 들고 있으므로 GC 대상.
    throw firstError.reason
  }

  const tracks: StemTrack[] = []
  try {
    for (const result of fetched as PromiseFulfilledResult<{ kind: string; bytes: ArrayBuffer }>[]) {
      if (options.signal?.aborted) {
        throw new DOMException('스템 로딩이 취소됨', 'AbortError')
      }
      const audioBuffer = await context.decodeAudioData(result.value.bytes)
      const player = new Tone.Player(audioBuffer).toDestination()
      player.fadeIn = STEM_FADE_SECONDS
      player.fadeOut = STEM_FADE_SECONDS
      tracks.push({ kind: result.value.kind, player, bufferDurationSeconds: audioBuffer.duration })
    }
  } catch (err) {
    for (const track of tracks) destroyTrack(track)
    throw err
  }

  let destroyed = false
  return {
    kinds: tracks.map((t) => t.kind),
    bufferTempoRatio: options.bufferTempoRatio,
    tracks,
    get destroyed() {
      return destroyed
    },
    destroy() {
      destroyed = true
      for (const track of tracks) destroyTrack(track)
    },
  }
}

/** `pool`을 바탕으로 한 재생 세션을 만든다. `attach()`를 부르기 전까지는
 * Transport와 아무 관계가 없다(이벤트 구독이 없으므로 Transport가 움직여도
 * 이 풀의 트랙은 반응 안 함 — 안전한 기본 상태). */
export function createStemPlayer(pool: StemBufferPool): StemPlayer {
  const transport = Tone.getTransport()

  let timing: StemSessionTiming | null = null
  let gateSeconds = 0
  let pendingGateOpenAt: number | null = null

  function stopAllTracks(time: number): void {
    for (const track of pool.tracks) {
      try {
        track.player.stop(time)
      } catch (err) {
        console.error('스템 정지 실패', track.kind, err)
      }
    }
  }

  // T6-11(Codex 모드C 1차 C-001 반영) — "방금 도착한 이벤트가 최종 상태"
  // 원칙: 타임스탬프 단조성만으로 이벤트를 거르지 않는다(정당한 상태 전이를
  // 놓칠 수 있음, Codex 지적). 대신 이벤트가 올 때마다 매번 "지금 가진 소스를
  // stop → 새 계획으로 start"를 그대로 재적용한다 — 멱등이라 중간 이벤트를
  // 하나 놓쳐도 다음 이벤트가 올바른 최종 상태로 수렴한다.
  // 과거 시각으로 네이티브 노드를 예약할 수 없다는 제약(Web Audio 스펙)만은
  // 반드시 지켜야 하므로, eventTime이 지금(Tone.immediate())보다 과거면
  // 지금 시각으로 끌어올린다(work/T6-11/plan.md "상태 전이 규칙" 표 참고).
  function handleTransportStart(eventTime: number): void {
    try {
      if (!timing || pool.destroyed) return
      const contextNow = Tone.immediate()
      const clampedTime = Math.max(eventTime, contextNow)
      const transportSeconds = transport.getSecondsAtTime(clampedTime)
      const plan = planStemStart({
        eventTime: clampedTime,
        transportSeconds,
        contextNow,
        gateSeconds,
        timing,
        bufferTempoRatio: pool.bufferTempoRatio,
      })
      stopAllTracks(clampedTime)
      for (const track of pool.tracks) {
        if (plan.bufferOffset < 0 || plan.bufferOffset >= track.bufferDurationSeconds) continue
        try {
          track.player.start(plan.startAt, plan.bufferOffset)
        } catch (err) {
          console.error('스템 시작 실패', track.kind, err)
        }
      }
      if (plan.gateOpenedNow) {
        gateSeconds = timing.songStartSeconds
        pendingGateOpenAt = null
      } else {
        pendingGateOpenAt = plan.startAt
      }
    } catch (err) {
      console.error('스템 Transport 동기화 실패(start)', err)
    }
  }

  function handleTransportStop(eventTime: number): void {
    try {
      if (!timing || pool.destroyed) return
      const contextNow = Tone.immediate()
      stopAllTracks(Math.max(eventTime, contextNow))
    } catch (err) {
      console.error('스템 Transport 동기화 실패(stop)', err)
    }
  }

  function maybeOpenPendingGate(time: number): void {
    if (timing && pendingGateOpenAt !== null && time >= pendingGateOpenAt) {
      gateSeconds = timing.songStartSeconds
      pendingGateOpenAt = null
    }
  }

  const onStart = (time: number): void => {
    maybeOpenPendingGate(time)
    handleTransportStart(time)
  }
  const onStop = (time: number): void => {
    handleTransportStop(time)
  }

  function unsubscribe(): void {
    transport.off('start', onStart)
    transport.off('loopStart', onStart)
    transport.off('stop', onStop)
    transport.off('pause', onStop)
  }

  return {
    attach(nextTiming) {
      // 이전 세션이 남아있으면 먼저 정리(두 번째 attach는 "세션 재시작"으로
      // 취급 — trackPlayer.ts의 reset()이 started를 안 지워 생기던 과거 버그
      // 부류를 구조적으로 차단, T3-16-feedback-6).
      this.detach()
      timing = nextTiming
      gateSeconds = nextTiming.audioStartSeconds
      pendingGateOpenAt = null
      // 재생 세션 동안 playbackRate는 상수(PracticeCanvas.tsx 확인됨 —
      // 재생/일시정지 중 BPM 변경은 UI에서 이미 막혀 있음)이므로, 매 start
      // 이벤트마다 다시 계산할 필요 없이 attach() 시점에 한 번만 설정한다.
      const nodeRate = stemNodePlaybackRate(nextTiming, pool.bufferTempoRatio)
      for (const track of pool.tracks) {
        track.player.playbackRate = nodeRate
      }
      transport.on('start', onStart)
      transport.on('loopStart', onStart)
      transport.on('stop', onStop)
      transport.on('pause', onStop)
    },
    detach() {
      unsubscribe()
      if (timing && !pool.destroyed) {
        stopAllTracks(Tone.immediate())
      }
      timing = null
      gateSeconds = 0
      pendingGateOpenAt = null
    },
    restartFromCurrentPosition() {
      handleTransportStart(Tone.immediate())
    },
    setChannelGain(kind, gain) {
      const track = pool.tracks.find((t) => t.kind === kind)
      if (!track || pool.destroyed) return
      track.player.volume.value = linearGainToDb(Math.min(1, Math.max(0, gain)))
    },
  }
}

/** T6-3(REQ-06, Q-33) — `trackPlayer.ts`에서 그대로 옮김(로직 변경 없음).
 * `available_audio_kinds`에서 'original'을 뺀 뒤, 'stem_music'이 있으면
 * (서버가 bass/vocals/other를 미리 합쳐둔 곡) 구 개별 스템은 걸러낸다. */
export function selectStemKinds(availableAudioKinds: readonly string[]): string[] {
  const kinds = availableAudioKinds.filter((kind) => kind !== 'original')
  if (!kinds.includes('stem_music')) return kinds
  return kinds.filter(
    (kind) => kind !== 'stem_bass' && kind !== 'stem_vocals' && kind !== 'stem_other',
  )
}
