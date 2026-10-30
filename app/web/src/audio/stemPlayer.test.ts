import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StemSessionTiming } from './stemSchedule'

// T6-11 — stemPlayer.ts는 Tone.Player/Tone.Transport에 직접 의존하므로
// jsdom에서 단위 테스트하려면 'tone' 전체를 가짜로 바꿔야 한다(trackPlayer.test.ts의
// vi.mock('tone', ...) 패턴과 같은 이유 — jsdom엔 실제 Web Audio가 없음).
// vi.hoisted()로 감싸는 이유도 동일(vi.mock 팩토리가 파일 맨 위로 호이스팅됨).
const { FakePlayer, playerInstances, decodeAudioDataMock, transportMock, immediateMock, emitTransport } =
  vi.hoisted(() => {
    class FakePlayer {
      fadeIn = 0
      fadeOut = 0
      playbackRate = 1
      volume = { value: 0 }
      buffer: unknown
      startCalls: Array<{ time: number; offset?: number }> = []
      stopCalls: number[] = []
      disposed = false
      constructor(buffer: unknown) {
        this.buffer = buffer
      }
      toDestination() {
        return this
      }
      start(time: number, offset?: number) {
        this.startCalls.push({ time, offset })
      }
      stop(time?: number) {
        this.stopCalls.push(time ?? -1)
      }
      dispose() {
        this.disposed = true
      }
    }
    const playerInstances: FakePlayer[] = []
    const decodeAudioDataMock = vi.fn(async (bytes: ArrayBuffer) => ({
      duration: 600, // 충분히 긴 더미 버퍼 — bufferOffset 범위 밖으로 안 나가게
      byteLength: bytes.byteLength,
    }))
    const listeners = new Map<string, Array<(time: number) => void>>()
    const transportMock = {
      on: vi.fn((event: string, cb: (time: number) => void) => {
        const list = listeners.get(event) ?? []
        list.push(cb)
        listeners.set(event, list)
      }),
      off: vi.fn((event: string, cb?: (time: number) => void) => {
        if (!cb) {
          listeners.set(event, [])
          return
        }
        listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb))
      }),
      getSecondsAtTime: vi.fn((time: number) => time),
    }
    function emitTransport(event: string, time: number): void {
      for (const cb of listeners.get(event) ?? []) cb(time)
    }
    const immediateMock = vi.fn(() => 0)
    return { FakePlayer, playerInstances, decodeAudioDataMock, transportMock, immediateMock, emitTransport }
  })

vi.mock('tone', () => ({
  // 화살표 함수는 `new`로 호출할 수 없어("is not a constructor", 실제 실행으로
  // 확인) mockImplementation에 일반 function을 써야 한다 — trackPlayer.test.ts의
  // window.Audio 모킹 때와 같은 이유.
  Player: vi.fn().mockImplementation(function (buffer: unknown) {
    const p = new FakePlayer(buffer)
    playerInstances.push(p)
    return p
  }),
  getContext: () => ({ decodeAudioData: decodeAudioDataMock }),
  getTransport: () => transportMock,
  immediate: () => immediateMock(),
}))

const { loadStemBufferPool, createStemPlayer, selectStemKinds } = await import('./stemPlayer')

function timing(overrides: Partial<StemSessionTiming> = {}): StemSessionTiming {
  return {
    songStartSeconds: 2,
    audioStartSeconds: 2,
    audioOffsetSeconds: 0,
    playbackRate: 1,
    latencyCompensationSeconds: 0,
    ...overrides,
  }
}

describe('loadStemBufferPool', () => {
  const OriginalFetch = window.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    playerInstances.length = 0
    decodeAudioDataMock.mockClear()
    decodeAudioDataMock.mockImplementation(async (bytes: ArrayBuffer) => ({
      duration: 600,
      byteLength: bytes.byteLength,
    }))
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    window.fetch = fetchMock as unknown as typeof window.fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.fetch = OriginalFetch
  })

  it('소스마다 fetch → decodeAudioData → Tone.Player를 만들고, fadeIn/fadeOut을 설정한다', async () => {
    const pool = await loadStemBufferPool(
      [
        { kind: 'stem_drums', url: 'http://x/drums.mp3' },
        { kind: 'stem_bass', url: 'http://x/bass.mp3' },
      ],
      { bufferTempoRatio: 1 },
    )

    expect(fetchMock).toHaveBeenCalledWith('http://x/drums.mp3', { signal: undefined })
    expect(fetchMock).toHaveBeenCalledWith('http://x/bass.mp3', { signal: undefined })
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
    expect(pool.kinds).toEqual(['stem_drums', 'stem_bass'])
    expect(pool.bufferTempoRatio).toBe(1)
    expect(playerInstances).toHaveLength(2)
    expect(playerInstances[0].fadeIn).toBeGreaterThan(0)
    expect(playerInstances[0].fadeOut).toBeGreaterThan(0)
  })

  it('HTTP 응답이 ok:false면 상태 코드를 포함한 에러를 던지고 Player는 하나도 안 만든다', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })

    await expect(
      loadStemBufferPool([{ kind: 'stem_drums', url: 'http://x/drums.mp3' }], { bufferTempoRatio: 1 }),
    ).rejects.toThrow('404')
    expect(playerInstances).toHaveLength(0)
  })

  it('두 소스 중 하나만 fetch가 실패해도(Promise.allSettled) 즉시 던지고 Player를 하나도 안 만든다', async () => {
    let callCount = 0
    fetchMock.mockImplementation(async () => {
      callCount += 1
      if (callCount === 2) throw new Error('네트워크 끊김 시뮬레이션')
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) }
    })

    await expect(
      loadStemBufferPool(
        [
          { kind: 'stem_drums', url: 'http://x/drums.mp3' },
          { kind: 'stem_bass', url: 'http://x/bass.mp3' },
        ],
        { bufferTempoRatio: 1 },
      ),
    ).rejects.toThrow('네트워크 끊김 시뮬레이션')
    expect(playerInstances).toHaveLength(0)
  })

  it('두 번째 트랙의 decodeAudioData가 실패하면 이미 만든 첫 번째 Player를 dispose()하고 재던진다', async () => {
    let callCount = 0
    decodeAudioDataMock.mockImplementation(async () => {
      callCount += 1
      if (callCount === 2) throw new Error('디코딩 실패 시뮬레이션')
      return { duration: 600, byteLength: 0 }
    })

    await expect(
      loadStemBufferPool(
        [
          { kind: 'stem_drums', url: 'http://x/drums.mp3' },
          { kind: 'stem_bass', url: 'http://x/bass.mp3' },
        ],
        { bufferTempoRatio: 1 },
      ),
    ).rejects.toThrow('디코딩 실패 시뮬레이션')

    expect(playerInstances).toHaveLength(1)
    expect(playerInstances[0].disposed).toBe(true)
  })

  it('destroy()는 모든 트랙의 Player를 dispose()하고 destroyed를 true로 만든다', async () => {
    const pool = await loadStemBufferPool([{ kind: 'stem_drums', url: 'http://x/drums.mp3' }], {
      bufferTempoRatio: 1,
    })

    pool.destroy()

    expect(playerInstances[0].disposed).toBe(true)
    expect(pool.destroyed).toBe(true)
  })
})

describe('createStemPlayer', () => {
  const OriginalFetch = window.fetch

  beforeEach(() => {
    playerInstances.length = 0
    decodeAudioDataMock.mockClear()
    decodeAudioDataMock.mockImplementation(async () => ({ duration: 600, byteLength: 0 }))
    transportMock.on.mockClear()
    transportMock.off.mockClear()
    transportMock.getSecondsAtTime.mockClear()
    transportMock.getSecondsAtTime.mockImplementation((time: number) => time)
    immediateMock.mockReset().mockReturnValue(0)
    window.fetch = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof window.fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.fetch = OriginalFetch
  })

  async function makePool(kinds: string[] = ['stem_drums']) {
    return loadStemBufferPool(
      kinds.map((kind) => ({ kind, url: `http://x/${kind}.mp3` })),
      { bufferTempoRatio: 1 },
    )
  }

  it('attach()는 start/loopStart/stop/pause 4개 이벤트를 구독한다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)

    player.attach(timing())

    const events = transportMock.on.mock.calls.map((c) => c[0])
    expect(events).toEqual(['start', 'loopStart', 'stop', 'pause'])
  })

  it('attach()는 네이티브 playbackRate를 stemNodePlaybackRate() 값으로 1회 설정한다(REQ-04 — 피치 보존)', async () => {
    const pool = await makePool() // bufferTempoRatio=1(개발용 임시 경로)
    const player = createStemPlayer(pool)

    player.attach(timing({ playbackRate: 1.3 }))

    expect(playerInstances[0].playbackRate).toBeCloseTo(1.3, 10)
  })

  it('카운트인 통과 후 start 이벤트 — 즉시 올바른 오프셋으로 player.start()를 호출한다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 2, playbackRate: 1 }))
    immediateMock.mockReturnValue(10)
    transportMock.getSecondsAtTime.mockReturnValue(7) // 카운트인(2) 이후 5초

    emitTransport('start', 10)

    expect(playerInstances[0].startCalls).toEqual([{ time: 10, offset: 5 }])
  })

  it('카운트인 중 start 이벤트 — 게이트 시각까지 미래로 예약하고, 그 시각 이후 이벤트에서 songStart로 게이트가 열린다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 2, audioStartSeconds: 2, playbackRate: 1 }))
    immediateMock.mockReturnValue(10)
    transportMock.getSecondsAtTime.mockReturnValue(0.5) // 아직 카운트인 중(게이트 2초 전)

    emitTransport('start', 10)

    // 게이트까지 1.5초 남음 → 11.5초에 예약, 그 시작 위치는 원곡 0초(offset 0).
    expect(playerInstances[0].startCalls).toEqual([{ time: 11.5, offset: 0 }])

    // 이제 게이트가 열렸어야 할 시각(11.5) 이후에 또 다른 start 이벤트(예: loopStart)가 오면
    // pendingGateOpenAt 로직이 게이트를 songStart로 영구 오픈한다.
    immediateMock.mockReturnValue(12)
    transportMock.getSecondsAtTime.mockReturnValue(2) // 정확히 songStart
    emitTransport('loopStart', 12)

    expect(playerInstances[0].startCalls[1]).toEqual({ time: 12, offset: 0 })
  })

  it('stop/pause 이벤트는 모든 트랙의 player.stop()을 호출한다', async () => {
    const pool = await makePool(['stem_drums', 'stem_bass'])
    const player = createStemPlayer(pool)
    player.attach(timing())
    immediateMock.mockReturnValue(5)

    emitTransport('stop', 5)

    expect(playerInstances[0].stopCalls).toEqual([5])
    expect(playerInstances[1].stopCalls).toEqual([5])
  })

  it('새 start 이벤트가 오면 기존 재생 중인 소스를 먼저 stop()하고 새로 start()한다(모드C C-001 — 멱등 재적용)', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 0 }))
    immediateMock.mockReturnValue(0)
    transportMock.getSecondsAtTime.mockReturnValue(1)
    emitTransport('start', 0)
    expect(playerInstances[0].startCalls).toHaveLength(1)

    immediateMock.mockReturnValue(3)
    transportMock.getSecondsAtTime.mockReturnValue(4) // 루프 재진입 등으로 재시작
    emitTransport('loopStart', 3)

    // 매 start류 이벤트는 "먼저 stop, 그다음 start"를 그대로 재적용하므로
    // (멱등 설계), 첫 이벤트(0초)의 stop(0)도 이미 기록돼 있다.
    expect(playerInstances[0].stopCalls).toEqual([0, 3])
    expect(playerInstances[0].startCalls).toHaveLength(2)
  })

  it('이벤트 처리가 늦어 eventTime이 이미 지난 시각이면 지금 시각으로 당겨 시작한다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 0 }))
    immediateMock.mockReturnValue(10.3) // 메인스레드 지연으로 실제론 더 늦게 처리됨
    transportMock.getSecondsAtTime.mockReturnValue(7)

    emitTransport('start', 10) // 원래 10초에 예정됐던 이벤트

    expect(playerInstances[0].startCalls[0].time).toBeCloseTo(10.3, 10)
  })

  it('detach()는 구독을 해제하고 즉시 모든 트랙을 정지시킨다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 0 }))
    immediateMock.mockReturnValue(0)
    transportMock.getSecondsAtTime.mockReturnValue(1)
    emitTransport('start', 0)
    playerInstances[0].stopCalls.length = 0
    immediateMock.mockReturnValue(5)
    // attach() 내부에서도 "이전 세션 정리"로 detach()를 1회 부르므로, 지금부터의
    // 호출 수만 보기 위해 여기서 리셋.
    transportMock.off.mockClear()

    player.detach()

    expect(playerInstances[0].stopCalls).toEqual([5])
    expect(transportMock.off).toHaveBeenCalledTimes(4)

    // detach 이후엔 더 이상 이벤트에 반응하지 않아야 함(구독 해제 확인).
    playerInstances[0].startCalls.length = 0
    emitTransport('start', 6)
    expect(playerInstances[0].startCalls).toHaveLength(0)
  })

  it('detach()를 여러 번 불러도 에러 없이 통과한다(멱등)', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing())

    expect(() => {
      player.detach()
      player.detach()
    }).not.toThrow()
  })

  it('attach()를 두 번 부르면 이전 세션의 구독을 먼저 정리해 이벤트가 중복 처리되지 않는다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 0 }))
    player.attach(timing({ songStartSeconds: 0 })) // 재시작
    immediateMock.mockReturnValue(0)
    transportMock.getSecondsAtTime.mockReturnValue(1)

    emitTransport('start', 0)

    // 중복 구독이었다면 2번 호출됐을 것.
    expect(playerInstances[0].startCalls).toHaveLength(1)
  })

  it('한 트랙에서 player.start()가 예외를 던져도 다른 트랙은 계속 시작된다(트랙별 에러 격리)', async () => {
    const pool = await makePool(['stem_drums', 'stem_bass'])
    playerInstances[0].start = () => {
      throw new Error('start 실패 시뮬레이션')
    }
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 0 }))
    immediateMock.mockReturnValue(0)
    transportMock.getSecondsAtTime.mockReturnValue(1)

    expect(() => emitTransport('start', 0)).not.toThrow()
    expect(playerInstances[1].startCalls).toHaveLength(1)
  })

  it('setChannelGain()은 일치하는 kind의 volume만 바꾸고, 알 수 없는 kind는 조용히 무시한다', async () => {
    const pool = await makePool(['stem_drums', 'stem_bass'])
    const player = createStemPlayer(pool)

    player.setChannelGain('stem_bass', 0.5)

    expect(playerInstances[0].volume.value).toBe(0)
    expect(playerInstances[1].volume.value).toBeCloseTo(20 * Math.log10(0.5), 10)
    expect(() => player.setChannelGain('nonexistent', 0.5)).not.toThrow()
  })

  it('풀이 destroy()된 뒤에는 Transport 이벤트가 와도 player.start()/stop()을 건드리지 않는다', async () => {
    const pool = await makePool()
    const player = createStemPlayer(pool)
    player.attach(timing({ songStartSeconds: 0 }))
    pool.destroy()
    playerInstances[0].startCalls.length = 0
    immediateMock.mockReturnValue(1)
    transportMock.getSecondsAtTime.mockReturnValue(1)

    expect(() => emitTransport('start', 1)).not.toThrow()
    expect(playerInstances[0].startCalls).toHaveLength(0)
  })
})

// T6-3(REQ-06, Q-33) — trackPlayer.ts에서 그대로 옮긴 순수 함수. 로직이 같으므로
// trackPlayer.test.ts의 동일 테스트와 같은 케이스를 재확인(회귀 방지).
describe('selectStemKinds', () => {
  it('strips "original" regardless of stem_music presence', () => {
    expect(selectStemKinds(['original', 'stem_drums'])).toEqual(['stem_drums'])
  })

  it('prefers stem_music and drops legacy individual stems when both are present', () => {
    const result = selectStemKinds(['original', 'stem_drums', 'stem_bass', 'stem_vocals', 'stem_other', 'stem_music'])
    expect(result).toEqual(['stem_drums', 'stem_music'])
  })
})
