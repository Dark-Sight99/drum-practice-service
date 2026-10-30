import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// jsdom의 HTMLMediaElement.play()는 실제로 "Not implemented"만 찍고 끝나(실제
// 실행으로 확인) 성공/실패 분기를 전혀 재현하지 못한다 — 그래서 prototype의
// play()/pause()를 직접 통제해 트랙별 언락 성공/실패를 의도적으로 만들어
// 검증한다(실제 재생 자체는 이 테스트의 범위 밖 — qa-evidence/T3-3/의 수동
// 실기기 QA로 확인, work/T3-3/plan.md §QA계획 1).
// T3-12 — trackPlayer.ts가 음량 제어를 `element.volume`(iOS에서 무시됨, 실제
// Apple 문서로 확인)에서 Web Audio GainNode로 옮기면서 Tone.js의
// AudioContext(`Tone.getContext().rawContext`)를 가져다 쓰게 됐다. jsdom엔
// Web Audio API 자체가 없어 Tone.js가 메서드 없는 빈 객체를 돌려주는
// DummyContext로 빠지므로(실제 실행으로 확인), 'tone' 모듈 전체를 가짜
// AudioContext로 모킹한다(이 파일은 createTrackPlayer()만 가져다 쓰므로 다른
// Tone export는 필요 없음). `vi.hoisted()`로 감싸는 이유 — vi.mock()의 팩토리는
// 호이스팅돼 파일 맨 위에서 먼저 실행되므로, 그 안에서 참조할 변수는
// `vi.hoisted()`로 먼저 선언해야 한다(Vitest 공식 패턴).
const FAKE_DESTINATION = { marker: 'destination' }
const { gainNodes, sourceNodes, createGainMock, createMediaElementSourceMock } = vi.hoisted(() => {
  const gainNodes: {
    gain: { value: number }
    connect: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }[] = []
  const sourceNodes: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const createGainMock = vi.fn(() => {
    const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
    gainNodes.push(node)
    return node
  })
  const createMediaElementSourceMock = vi.fn(() => {
    const node = { connect: vi.fn(), disconnect: vi.fn() }
    sourceNodes.push(node)
    return node
  })
  return { gainNodes, sourceNodes, createGainMock, createMediaElementSourceMock }
})
vi.mock('tone', () => ({
  getContext: () => ({
    rawContext: {
      createMediaElementSource: createMediaElementSourceMock,
      createGain: createGainMock,
      destination: FAKE_DESTINATION,
    },
  }),
}))

// T6-6 — trackPlayer.ts가 Tone 컨텍스트 대신(또는 실패 시 폴백으로) iOS 전용 스템
// 컨텍스트를 쓰므로, 그 선택 분기를 검증하려면 getIOSStemAudioContext()를 통제할 수
// 있어야 한다. isIOS()는 실제 구현 그대로 둬서(vi.importActual) 기존 테스트들의
// stubIOSUserAgent() 패턴이 그대로 동작하게 한다 — getIOSStemAudioContext()만 교체.
// 기본값 null — jsdom엔 실제 AudioContext가 없어 실제 구현도 항상 null을 반환하는
// 것과 동일한 상태라, 기존(T6-6 이전) 테스트들의 "Tone 컨텍스트로 폴백" 동작을 그대로
// 보존한다. 새 테스트만 .mockReturnValue()로 override.
const { getIOSStemAudioContextMock } = vi.hoisted(() => ({
  getIOSStemAudioContextMock: vi.fn(() => null as unknown),
}))
vi.mock('./platformAudioContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platformAudioContext')>()
  return { ...actual, getIOSStemAudioContext: getIOSStemAudioContextMock }
})

const { createAudioTrackPool, createTrackPlayer, selectStemKinds } = await import('./trackPlayer')
type TrackSource = { kind: string; url: string }

// T3-16-feedback-3 — Web Audio(GainNode) 경로는 이제 iOS에서만 탄다(맥에서
// 실시간보다 느리게 재생되는 버그 발견, trackPlayer.ts 모듈 상단 주석 참고).
// jsdom 기본 User-Agent는 iOS가 아니라서, Web Audio 경로를 검증하는 테스트는
// 이걸로 iPhone을 흉내낸다 — `afterEach`의 `vi.restoreAllMocks()`가 자동 복원.
const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
function stubIOSUserAgent(): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_USER_AGENT)
}

// T3-16-feedback-6 — `createTrackPlayer()`가 이제 풀(`AudioTrackPool`)을
// 받는 얇은 래퍼로 바뀌어서(work/T3-16-feedback-6/plan.md), 기존 테스트
// 대부분이 쓰던 "sources 배열 → 바로 플레이어" 한 단계 호출을 그대로
// 흉내내는 헬퍼. 풀 자체(prime() 캐싱, destroy())를 검증하는 테스트는
// `createAudioTrackPool()`을 직접 불러 풀 레퍼런스를 따로 들고 있는다.
// T3-16-feedback-7 — createAudioTrackPool()이 비동기(파일 전체를 fetch()로
// 미리 받음)로 바뀌어서 이 헬퍼도 async로 바뀜 — 모든 호출부에 await 필요.
async function createPlayer(sources: TrackSource[]) {
  return createTrackPlayer(await createAudioTrackPool(sources))
}

describe('createTrackPlayer', () => {
  let playMock: Mock<() => Promise<void>>
  let pauseMock: Mock<() => void>
  // T3-16-feedback-3 — 데스크톱 경로(element.volume 직접 제어) 테스트용으로
  // createAudioTrackPool()이 만드는 실제 <audio> 엘리먼트를 생성 순서대로
  // 추적(sources 배열과 같은 순서 — 아래 createGainMock 등과 같은 패턴).
  let createdAudioElements: HTMLAudioElement[]
  // vi.spyOn(window, 'Audio')는 화살표 함수 mockImplementation이 `new`로 호출이
  // 안 돼("is not a constructor") 실제 실행으로 확인 — 생성자는 직접 교체·복원.
  const OriginalAudio = window.Audio
  // T3-16-feedback-7 — jsdom엔 fetch()의 실제 네트워크 구현이 없고(있어도
  // 실제 요청을 보내면 안 됨), URL.createObjectURL/revokeObjectURL은 jsdom이
  // 아예 구현하지 않아("Not implemented") 호출하면 콘솔 에러만 찍고 undefined를
  // 반환한다(실제 실행으로 확인) — 셋 다 직접 교체·복원.
  const OriginalFetch = window.fetch
  const OriginalCreateObjectURL = window.URL.createObjectURL
  const OriginalRevokeObjectURL = window.URL.revokeObjectURL
  let fetchMock: ReturnType<typeof vi.fn>
  let createObjectURLMock: ReturnType<typeof vi.fn>
  let revokeObjectURLMock: ReturnType<typeof vi.fn>
  let objectUrlCounter: number

  beforeEach(() => {
    playMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    pauseMock = vi.fn<() => void>()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock)
    createdAudioElements = []
    window.Audio = function (this: unknown, src?: string) {
      const el = new OriginalAudio(src)
      createdAudioElements.push(el)
      return el
    } as unknown as typeof Audio
    objectUrlCounter = 0
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['fake-audio'], { type: 'audio/mpeg' }),
    }))
    window.fetch = fetchMock as unknown as typeof window.fetch
    createObjectURLMock = vi.fn(() => `blob:mock-${++objectUrlCounter}`)
    revokeObjectURLMock = vi.fn()
    window.URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
    window.URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL
    // afterEach의 vi.restoreAllMocks()가 일반 vi.fn()의 구현까지 비워버리므로
    // (spyOn 대상이 아니라 "복원할 원본"이 없어 매번 다시 설정해야 함), 매
    // 테스트 시작마다 구현을 다시 붙인다.
    gainNodes.length = 0
    sourceNodes.length = 0
    createGainMock.mockReset().mockImplementation(() => {
      const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
      gainNodes.push(node)
      return node
    })
    createMediaElementSourceMock.mockReset().mockImplementation(() => {
      const node = { connect: vi.fn(), disconnect: vi.fn() }
      sourceNodes.push(node)
      return node
    })
    // T6-6 — 기본값으로 리셋(Tone 컨텍스트 폴백 경로) — 개별 테스트만 override.
    getIOSStemAudioContextMock.mockReset().mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.Audio = OriginalAudio
    window.fetch = OriginalFetch
    window.URL.createObjectURL = OriginalCreateObjectURL
    window.URL.revokeObjectURL = OriginalRevokeObjectURL
  })

  it('T3-12/T3-16-feedback-3: iOS에서 각 트랙을 Web Audio로 연결(source → gain → destination)', async () => {
    stubIOSUserAgent()

    await createPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])

    expect(createMediaElementSourceMock).toHaveBeenCalledTimes(2)
    expect(createGainMock).toHaveBeenCalledTimes(2)
    expect(sourceNodes[0].connect).toHaveBeenCalledWith(gainNodes[0])
    expect(sourceNodes[1].connect).toHaveBeenCalledWith(gainNodes[1])
    expect(gainNodes[0].connect).toHaveBeenCalledWith(FAKE_DESTINATION)
    expect(gainNodes[1].connect).toHaveBeenCalledWith(FAKE_DESTINATION)
  })

  it('T3-16-feedback-3 모드A 지적(C-001) 반영 — UA에 "iPad"가 그대로 찍히는 기기도 iOS로 인식', async () => {
    // iPadOS 13+ 기본값은 "Macintosh" 위장 UA를 보내지만(아래 다른 테스트가
    // 그 경로를 이미 검증), 구버전·일부 설정은 UA에 "iPad"가 그대로 남는다 —
    // 멀티터치 폴백에만 의존하면 이 경우를 놓쳐 Web Audio를 건너뛰고
    // element.volume으로 빠져 T3-12 버그가 재발할 뻔했음(모드A 발견).
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    )

    await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])

    expect(createMediaElementSourceMock).toHaveBeenCalledTimes(1)
  })

  it('T3-16-feedback-3: 데스크톱(iOS 아님)에서는 Web Audio를 전혀 안 거침', async () => {
    // jsdom 기본 User-Agent는 이미 iOS가 아니므로 별도 스텁 없이 기본 상태로 검증.
    await createPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])

    expect(createMediaElementSourceMock).not.toHaveBeenCalled()
    expect(createGainMock).not.toHaveBeenCalled()
  })

  describe('T6-6 — iOS 전용 스템 AudioContext 분리', () => {
    it('iOS에서 getIOSStemAudioContext()가 컨텍스트를 주면 Tone 컨텍스트가 아니라 그걸로 노드를 연결한다', async () => {
      stubIOSUserAgent()
      const stemCreateGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }))
      const stemCreateMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
      const STEM_DESTINATION = { marker: 'stem-destination' }
      getIOSStemAudioContextMock.mockReturnValue({
        createGain: stemCreateGain,
        createMediaElementSource: stemCreateMediaElementSource,
        destination: STEM_DESTINATION,
        resume: vi.fn(),
      })

      await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])

      expect(stemCreateMediaElementSource).toHaveBeenCalledTimes(1)
      expect(stemCreateGain).toHaveBeenCalledTimes(1)
      // Tone 쪽(기존 모킹된 컨텍스트)은 전혀 안 건드려야 함.
      expect(createMediaElementSourceMock).not.toHaveBeenCalled()
      expect(createGainMock).not.toHaveBeenCalled()
    })

    it('iOS인데 getIOSStemAudioContext()가 null이면(생성 실패) Tone 컨텍스트로 폴백한다', async () => {
      stubIOSUserAgent()
      getIOSStemAudioContextMock.mockReturnValue(null)

      await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])

      expect(createMediaElementSourceMock).toHaveBeenCalledTimes(1)
      expect(createGainMock).toHaveBeenCalledTimes(1)
    })

    it('prime()이 전용 스템 컨텍스트의 resume()을 호출한다', async () => {
      stubIOSUserAgent()
      const resumeMock = vi.fn()
      getIOSStemAudioContextMock.mockReturnValue({
        createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
        createMediaElementSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
        destination: {},
        resume: resumeMock,
      })

      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      expect(resumeMock).toHaveBeenCalled()
    })

    it('스템 컨텍스트가 없으면(데스크톱) prime()이 resume()을 호출할 대상 자체가 없어 에러 없이 통과한다', async () => {
      // jsdom 기본 User-Agent(iOS 아님) — getIOSStemAudioContextMock은 기본값 null,
      // isIOS()도 false라 Tone 폴백조차 없음(stemContext가 애초에 null).
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await expect(player.prime()).resolves.toBeDefined()
    })
  })

  describe('T3-16-feedback-7 — createAudioTrackPool(): 재생 전 fetch()로 전체를 받아 blob URL로 변환', () => {
    it('각 소스를 fetch()로 받아 blob URL을 만들고 엘리먼트 src로 씀', async () => {
      await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.mp3' },
        { kind: 'stem_bass', url: 'http://x/bass.mp3' },
      ])

      expect(fetchMock).toHaveBeenCalledWith('http://x/drums.mp3')
      expect(fetchMock).toHaveBeenCalledWith('http://x/bass.mp3')
      expect(createObjectURLMock).toHaveBeenCalledTimes(2)
      expect(createdAudioElements[0].src).toBe('blob:mock-1')
      expect(createdAudioElements[1].src).toBe('blob:mock-2')
    })

    it('HTTP 응답이 ok:false면 상태 코드를 포함한 에러를 던짐', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404, blob: async () => new Blob([]) })

      await expect(createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.mp3' }])).rejects.toThrow('404')
    })

    it('모드C 지적(C-001) 반영 — 트랙 하나의 fetch가 실패해도(Promise.allSettled) 이미 받은 다른 트랙의 blob URL은 새지 않고 해제됨', async () => {
      let callCount = 0
      fetchMock.mockImplementation(async () => {
        callCount += 1
        if (callCount === 2) throw new Error('네트워크 끊김 시뮬레이션')
        return { ok: true, status: 200, blob: async () => new Blob(['fake-audio']) }
      })

      await expect(
        createAudioTrackPool([
          { kind: 'stem_drums', url: 'http://x/drums.mp3' },
          { kind: 'stem_bass', url: 'http://x/bass.mp3' },
        ]),
      ).rejects.toThrow('네트워크 끊김 시뮬레이션')

      // stem_drums는 fetch까지 성공해 blob URL을 만들었을 것 — 바깥 정리
      // 루프가 반드시 revokeObjectURL로 해제해야 함(새지 않아야 함).
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
    })
  })

  it('prime() reports ok:true for every source when play() succeeds', async () => {
    const player = await createPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])
    const results = await player.prime()
    expect(results).toEqual([
      { kind: 'stem_drums', ok: true },
      { kind: 'stem_bass', ok: true },
    ])
    // 언락 과정은 play() 후 즉시 pause()(모바일 자동재생 정책 — 실제로 들리면 안 됨)
    expect(pauseMock).toHaveBeenCalledTimes(2)
  })

  it('prime() reports ok:false only for the source whose play() rejects, not the others', async () => {
    let callCount = 0
    playMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 2) return Promise.reject(new DOMException('', 'NotAllowedError'))
      return Promise.resolve(undefined)
    })
    const player = await createPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])
    const results = await player.prime()
    expect(results).toEqual([
      { kind: 'stem_drums', ok: true },
      { kind: 'stem_bass', ok: false },
    ])
  })

  describe('T3-16-feedback-6 — AudioTrackPool: prime()은 풀 스코프, 세션마다 다시 안 함', () => {
    it('prime()을 두 번 불러도 이미 언락된 트랙은 play()를 다시 시도하지 않음(모드C 1라운드 C-001/2라운드 C-006)', async () => {
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await pool.prime()
      playMock.mockClear()

      await pool.prime() // 이미 unlocked — 캐시된 결과만 반환해야 함

      expect(playMock).not.toHaveBeenCalled()
    })

    it('진행 중인 prime() 호출이 있으면 같은 Promise를 공유(중복 play() 방지, 모드C 1라운드 C-001)', async () => {
      let resolvePlay: (() => void) | undefined
      playMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePlay = resolve
          }),
      )
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])

      const first = pool.prime()
      const second = pool.prime() // 1차가 아직 안 끝난 상태에서 재호출

      resolvePlay?.()
      await Promise.all([first, second])

      // 겹친 두 호출이 같은 트랙에 play()를 두 번 걸지 않아야 함.
      expect(playMock).toHaveBeenCalledTimes(1)
    })

    it('새 세션(createTrackPlayer)을 여러 번 만들어도 같은 풀이면 createMediaElementSource는 트랙당 1번만(모드C 3라운드 C-007)', async () => {
      stubIOSUserAgent()
      const pool = await createAudioTrackPool([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      createMediaElementSourceMock.mockClear() // 풀 생성 시점 호출은 제외
      createGainMock.mockClear()

      const sessionA = createTrackPlayer(pool)
      await sessionA.prime()
      sessionA.reset()
      const sessionB = createTrackPlayer(pool) // 같은 풀로 2번째 "재생" 세션
      await sessionB.prime()

      expect(createMediaElementSourceMock).not.toHaveBeenCalled()
      expect(createGainMock).not.toHaveBeenCalled()
    })

    it('재생 거부로 unlocked가 false가 된 트랙은 다음 prime()에서 실제로 재언락을 시도(모드C 2라운드 C-006)', async () => {
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await pool.prime() // 1차 언락 성공
      const session = createTrackPlayer(pool)
      playMock.mockClear()
      playMock.mockRejectedValueOnce(new DOMException('', 'AbortError'))
      session.playFrom(0, 1)
      await Promise.resolve().then(() => Promise.resolve()) // catch 핸들러 대기 — unlocked=false로 내려감
      playMock.mockClear()
      playMock.mockResolvedValue(undefined)

      await pool.prime() // 이번엔 캐시 생략 없이 진짜로 다시 시도해야 함

      expect(playMock).toHaveBeenCalledTimes(1)
    })

    it('destroy() 이후 늦게 끝나는 prime() 결과가 상태를 되살리지 않음(모드C 1라운드 C-001)', async () => {
      let resolvePlay: (() => void) | undefined
      playMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolvePlay = resolve
          }),
      )
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      const primePromise = pool.prime() // 아직 안 끝남

      pool.destroy() // 화면을 벗어남 — 풀 파괴
      resolvePlay?.() // 그제서야 늦게 play()가 resolve
      const results = await primePromise

      // destroy() 이후엔 성공으로 기록하지 않아야 함(터지지만 않으면 됨 —
      // 이미 파괴된 풀의 트랙을 재생에 쓸 일 자체가 없음).
      expect(results[0].ok).toBe(false)
    })
  })

  it('playFrom() skips a track that failed to unlock, but still plays the others', async () => {
    let callCount = 0
    playMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 2) return Promise.reject(new DOMException('', 'NotAllowedError'))
      return Promise.resolve(undefined)
    })
    const player = await createPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])
    await player.prime()
    playMock.mockClear()
    playMock.mockResolvedValue(undefined)

    player.playFrom(5, 1)

    // stem_bass(2번째, 언락 실패)는 playFrom에서 play()가 다시 호출되지 않아야 함
    expect(playMock).toHaveBeenCalledTimes(1)
  })

  it('playFrom() pauses the element when play() rejects mid-session (T3-6 모드A 2라운드 지적 — A-B 루프 재진입 중 거부돼도 소리가 안 남아야 함)', async () => {
    // 루프 재진입 시나리오: 이미 언락된 트랙에 playFrom()을 다시 불렀는데
    // (예: 네트워크 문제 등으로) 이번엔 거부되는 경우. unlocked=false가 되면
    // 이후 pause()/resume()이 전부 이 트랙을 건너뛰므로, play() 거부 시점에
    // 명시적으로 pause()해두지 않으면 끌 방법이 없는 소리가 남을 수 있었다.
    const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
    await player.prime()
    playMock.mockClear()
    pauseMock.mockClear()
    playMock.mockRejectedValueOnce(new DOMException('', 'AbortError'))

    player.playFrom(5, 1)
    await Promise.resolve().then(() => Promise.resolve()) // catch 핸들러가 돌 때까지 마이크로태스크 양보

    expect(pauseMock).toHaveBeenCalledTimes(1)
  })

  it('playFrom() sets preservesPitch/playbackRate/currentTime on unlocked tracks', async () => {
    const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
    await player.prime()
    playMock.mockClear()

    player.playFrom(12.5, 1.3)

    expect(playMock).toHaveBeenCalledTimes(1)
  })

  describe('resync()', () => {
    // 모드A 지적(Medium, 실제 버그 — jsdom으로 재현): 수정 전엔
    // `currentTime * playbackRate`로 "실제 위치"를 계산했는데, `currentTime`은
    // 이미 원곡 파일 기준 초(`expectedSongPositionSeconds`와 같은 단위)라
    // 1배속이 아닐 때 비교 자체가 틀렸다(예: 0.5배속에서 currentTime=0.5는
    // "완벽히 동기"인데 실제로는 0.25로 계산돼 매번 틀리게 "보정"했을 것).
    // 지금은 resync()가 playbackRate를 받지 않도록 바꿔 그 버그 자체가 API
    // 수준에서 재발할 수 없게 했다. 수정 전엔 "예외만 안 나면 통과"하는
    // 테스트였음(모드A가 정확히 지적한 약점) — 이번엔 `currentTime` setter를
    // 직접 스파이해(call-through 유지) 실제로 보정됐는지/안 됐는지를
    // 값으로 검증한다.
    async function primedUnpausedPlayer(initialCurrentTime: number, playbackRate = 1) {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
      player.playFrom(initialCurrentTime, playbackRate)
      return player
    }

    // T6-10(REQ-06, Q-33) — resync()가 "임계값 넘으면 항상 즉시 seek"에서
    // "작은 드리프트는 playbackRate로 서서히 보정, 비정상적으로 큰 드리프트만
    // 즉시 seek"로 바뀜(실기기에서 seek 자체가 iOS 성능 문제의 원인으로 확정됨,
    // work/T6-10/plan.md). 아래 테스트들은 새 3단계 분기(무시/소프트 보정/
    // 하드 스냅)와 히스테리시스를 직접 검증한다.
    it('does NOT touch currentTime or playbackRate when drift is within the entry threshold', async () => {
      const player = await primedUnpausedPlayer(5.02)
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear() // playFrom() 안의 초기 seek 호출은 제외하고 resync()만 본다

      player.resync(5.0, 0.1, 1) // 드리프트 0.02초 < 진입 임계값 0.1초

      expect(setSpy).not.toHaveBeenCalled()
      expect(createdAudioElements[0].playbackRate).toBe(1)
    })

    it('soft-corrects via playbackRate (not a seek) when drift exceeds the entry threshold but stays under the hard-snap threshold', async () => {
      const player = await primedUnpausedPlayer(5.5)
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      // 드리프트 0.5초(실제가 기대보다 "앞서" 있음) > 진입 임계값 0.1초,
      // < 하드 스냅 임계값(2.0초) — seek 없이 배속만 살짝 느려져야 한다.
      player.resync(5.0, 0.1, 1)

      expect(setSpy).not.toHaveBeenCalled()
      expect(createdAudioElements[0].playbackRate).toBeLessThan(1)
      expect(createdAudioElements[0].playbackRate).toBeGreaterThanOrEqual(1 - 0.08) // RESYNC_MAX_RATE_DELTA
    })

    it('soft-corrects in the opposite direction when the track has fallen behind', async () => {
      const player = await primedUnpausedPlayer(4.5)

      // 드리프트 -0.5초(실제가 기대보다 "뒤처져" 있음) — 배속이 더 빨라져야 한다.
      player.resync(5.0, 0.1, 1)

      expect(createdAudioElements[0].playbackRate).toBeGreaterThan(1)
      expect(createdAudioElements[0].playbackRate).toBeLessThanOrEqual(1 + 0.08)
    })

    it('clamps the soft correction to RESYNC_MAX_RATE_DELTA even for a large-but-sub-hard-snap drift', async () => {
      const player = await primedUnpausedPlayer(5.3) // 드리프트 0.3초 < 하드 스냅 0.5초
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(5.0, 0.1, 1)

      expect(setSpy).not.toHaveBeenCalled() // 여전히 소프트 보정 — seek 없음
      expect(createdAudioElements[0].playbackRate).toBeCloseTo(1 - 0.08, 5)
    })

    it('hard-snaps currentTime and resets playbackRate when drift exceeds the hard-snap threshold', async () => {
      const player = await primedUnpausedPlayer(5.8) // 드리프트 0.8초 > 하드 스냅 0.5초
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(5.0, 0.1, 1)

      expect(setSpy).toHaveBeenCalledWith(5.0)
      expect(createdAudioElements[0].playbackRate).toBe(1)
    })

    it('hysteresis: does NOT start correcting for drift between the exit and entry thresholds when not already correcting', async () => {
      const player = await primedUnpausedPlayer(5.07) // 드리프트 0.07초: 이탈(0.05)~진입(0.1) 사이
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(5.0, 0.1, 1)

      expect(setSpy).not.toHaveBeenCalled()
      expect(createdAudioElements[0].playbackRate).toBe(1) // 보정 시작 안 함
    })

    it('hysteresis: keeps correcting for drift between the exit and entry thresholds once already correcting', async () => {
      const player = await primedUnpausedPlayer(5.5)
      // 1차 호출로 보정 상태 진입(드리프트 0.5초 > 진입 임계값).
      player.resync(5.0, 0.1, 1)
      expect(createdAudioElements[0].playbackRate).not.toBe(1)

      // 2차 호출 — 드리프트가 0.07초(이탈 0.05~진입 0.1 사이)로 줄었다고
      // 가정(currentTime을 직접 되돌려 시뮬레이션). 이미 보정 중이었으므로
      // 이탈 임계값(0.05초)보다 작아지기 전까진 계속 보정 유지돼야 한다.
      createdAudioElements[0].currentTime = 5.07
      player.resync(5.0, 0.1, 1)

      expect(createdAudioElements[0].playbackRate).not.toBe(1)
    })

    it('hysteresis: resets to basePlaybackRate once drift falls below the exit threshold', async () => {
      const player = await primedUnpausedPlayer(5.5)
      player.resync(5.0, 0.1, 1) // 보정 상태 진입
      expect(createdAudioElements[0].playbackRate).not.toBe(1)

      createdAudioElements[0].currentTime = 5.02 // 드리프트 0.02초 < 이탈 임계값 0.05초
      player.resync(5.0, 0.1, 1)

      expect(createdAudioElements[0].playbackRate).toBe(1)
    })

    it('does NOT correct when currentTime already equals the expected position (0.5x-speed unit-bug regression)', async () => {
      // 모드A 2라운드 지적 반영 — 트랙의 playbackRate를 실제로 0.5로 둬서
      // "0.5배속" 시나리오를 이름 그대로 재현한다(1차 수정 때는 1배속으로
      // 돌려놓고 이름만 0.5배속이라고 적었던 약점). currentTime(원곡 파일
      // 기준)이 expectedSongPositionSeconds와 정확히 같은 "완벽히 동기" 상태 —
      // 수정 전 버그였다면 playbackRate=0.5를 곱해 실제 위치를 0.25로 잘못
      // 계산해 드리프트가 있다고 오판, 불필요하게 currentTime을 다시 썼을 것.
      const player = await primedUnpausedPlayer(0.5, 0.5)
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(0.5, 0.1, 0.5)

      expect(setSpy).not.toHaveBeenCalled()
      expect(createdAudioElements[0].playbackRate).toBe(0.5)
    })

    it('skips a track that failed to unlock, even with a huge drift', async () => {
      playMock.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime() // 언락 실패
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(999, 0.001, 1)

      expect(setSpy).not.toHaveBeenCalled()
    })

    it('skips a track that is still paused (never actually started), even with a huge drift', async () => {
      // primedUnpausedPlayer를 안 쓰고 paused를 그대로 둔다(jsdom 기본값 true).
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime() // 언락은 성공하지만 playFrom()을 호출 안 해 paused=true 그대로
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(999, 0.001, 1)

      expect(setSpy).not.toHaveBeenCalled()
    })
  })

  it('stop() pauses every track', async () => {
    const player = await createPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])
    await player.prime()
    pauseMock.mockClear()

    player.stop()

    expect(pauseMock).toHaveBeenCalledTimes(2)
  })

  describe('reset() — T3-16-feedback-6: 세션만 정리, 엘리먼트는 재사용(구 dispose()를 대체)', () => {
    it('일시정지만 하고 unlocked는 그대로 유지(풀 스코프라 다음 세션도 재언락 불필요 — 모드C 2라운드 C-005)', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      pauseMock.mockClear()
      playMock.mockClear()

      player.reset()
      // reset() 뒤에도 다시 prime()하면 캐시된 결과만 반환(진짜 재시도 없음)
      const results = await player.prime()

      expect(pauseMock).toHaveBeenCalledTimes(1)
      expect(playMock).not.toHaveBeenCalled() // 캐시 적중 — 재시도 안 함
      expect(results).toEqual([{ kind: 'stem_drums', ok: true }])
    })

    it('started를 false로 되돌려 resume()이 조기 재생하지 않게 함', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      player.playFrom(0, 1) // started=true

      player.reset()
      playMock.mockClear()
      player.resume()

      expect(playMock).not.toHaveBeenCalled() // started가 리셋됐으므로 resume()이 건너뜀
    })

    it('엘리먼트를 파괴하지 않음(src를 안 비움) — 다음 세션이 재사용할 수 있어야 함', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      const el = createdAudioElements[0]
      const originalSrc = el.src

      player.reset()

      expect(el.src).toBe(originalSrc) // dispose()였다면 ''로 비워졌을 것
    })
  })

  describe('AudioTrackPool.destroy() — T3-16-feedback-6: 풀 전체 파괴(구 dispose()의 "엘리먼트 파괴" 부분을 이어받음)', () => {
    it('모든 트랙을 일시정지시킴', async () => {
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await pool.prime()
      pauseMock.mockClear()

      pool.destroy()

      expect(pauseMock).toHaveBeenCalledTimes(1)
    })

    it('iOS에서는 Web Audio 그래프 노드를 끊음(T3-12)', async () => {
      stubIOSUserAgent()
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await pool.prime()

      pool.destroy()

      expect(gainNodes[0].disconnect).toHaveBeenCalledTimes(1)
      expect(sourceNodes[0].disconnect).toHaveBeenCalledTimes(1)
    })

    it('데스크톱(노드 없음)에서도 안 터짐', async () => {
      const pool = await createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await pool.prime()

      expect(() => pool.destroy()).not.toThrow()
    })

    it('모드C 3라운드 지적(Medium, C-003/C-008) — 트랙 하나 정리가 실패해도 나머지 트랙은 계속 정리됨', async () => {
      const pool = await createAudioTrackPool([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await pool.prime()
      pauseMock.mockClear()
      // 1번째 트랙의 pause()만 던지도록(미디어 준비 전 예외 등 흉내) 설정.
      let callCount = 0
      pauseMock.mockImplementation(() => {
        callCount += 1
        if (callCount === 1) throw new Error('이 트랙은 아직 준비 안 됨')
      })

      expect(() => pool.destroy()).not.toThrow()
      // 1번째가 던져도 2번째 트랙의 pause()는 여전히 호출돼야 함.
      expect(pauseMock).toHaveBeenCalledTimes(2)
    })

    it('T3-16-feedback-7 — 모든 트랙의 blob URL을 revokeObjectURL로 해제함(안 하면 페이지가 떠 있는 동안 메모리에 남음)', async () => {
      const pool = await createAudioTrackPool([
        { kind: 'stem_drums', url: 'http://x/drums.mp3' },
        { kind: 'stem_bass', url: 'http://x/bass.mp3' },
      ])
      await pool.prime()
      revokeObjectURLMock.mockClear()

      pool.destroy()

      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-2')
    })
  })

  describe('createAudioTrackPool() — 모드C 3라운드 지적(Medium, C-008): 생성 도중 일부만 만들고 실패하면 정리 후 재던짐', () => {
    it('두 번째 트랙 생성이 실패하면 첫 번째 트랙을 정리하고 예외를 다시 던짐', async () => {
      stubIOSUserAgent()
      let callCount = 0
      createMediaElementSourceMock.mockImplementation(() => {
        callCount += 1
        if (callCount === 2) throw new Error('Web Audio 노드 생성 실패 시뮬레이션')
        const node = { connect: vi.fn(), disconnect: vi.fn() }
        sourceNodes.push(node)
        return node
      })

      await expect(
        createAudioTrackPool([
          { kind: 'stem_drums', url: 'http://x/drums.wav' },
          { kind: 'stem_bass', url: 'http://x/bass.wav' },
        ]),
      ).rejects.toThrow('Web Audio 노드 생성 실패 시뮬레이션')

      // 두 트랙 다 정리(일시정지)됐어야 함 — 첫 번째(stem_drums)는 이미
      // 완성돼 바깥 catch의 정리 루프가, 두 번째(stem_bass, 실패한 그
      // 트랙 자신)는 모드A 지적으로 추가한 안쪽 catch의 즉시 정리가 맡는다.
      expect(pauseMock).toHaveBeenCalledTimes(2)
      // T3-16-feedback-7 — 두 트랙 다 fetch()까지는 성공해 blob URL을 만들었을
      // 것이므로, 정리 과정에서 둘 다 revokeObjectURL로 해제돼야 함.
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-2')
    })

    it('모드A 지적(필수, 반영함) — createMediaElementSource()는 성공하고 createGain()이 실패해도(같은 트랙 안에서) 그 트랙의 엘리먼트·부분 생성된 노드가 샘 없이 정리됨', async () => {
      stubIOSUserAgent()
      createGainMock.mockImplementation(() => {
        throw new Error('createGain 실패 시뮬레이션')
      })

      await expect(createAudioTrackPool([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])).rejects.toThrow(
        'createGain 실패 시뮬레이션',
      )

      // 이 트랙은 tracks 배열에 push되기 전에 실패했지만(바깥 catch의 정리
      // 루프가 못 보는 범위), 실패 지점에서 즉시 자기 자신을 정리해야 한다 —
      // element.pause()와 이미 만들어진 sourceNode.disconnect() 둘 다.
      expect(pauseMock).toHaveBeenCalledTimes(1)
      expect(sourceNodes[0].disconnect).toHaveBeenCalledTimes(1)
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
    })
  })

  describe('seekTo() — T3-9(REQ-04): 위치만 옮기고 재생은 시작하지 않음', () => {
    it('repositions unlocked tracks (currentTime/playbackRate/preservesPitch) without calling play()', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      playMock.mockClear()
      const setCurrentTime = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setCurrentTime.mockClear()

      player.seekTo(12.5, 1.3)

      expect(setCurrentTime).toHaveBeenCalledWith(12.5)
      expect(playMock).not.toHaveBeenCalled() // playFrom()과의 핵심 차이 — 재생 시작 안 함
    })

    it('clamps a negative position to 0', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      const setCurrentTime = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setCurrentTime.mockClear()

      player.seekTo(-5, 1)

      expect(setCurrentTime).toHaveBeenCalledWith(0)
    })

    it('skips a track that failed to unlock', async () => {
      let callCount = 0
      playMock.mockImplementation(() => {
        callCount += 1
        if (callCount === 2) return Promise.reject(new DOMException('', 'NotAllowedError'))
        return Promise.resolve(undefined)
      })
      const player = await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime() // stem_bass 언락 실패
      const setCurrentTime = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setCurrentTime.mockClear()

      player.seekTo(10, 1)

      expect(setCurrentTime).toHaveBeenCalledTimes(1) // 언락된 stem_drums만
    })

    it('does not touch the started flag or muted/unlocked state (purely cosmetic position change)', async () => {
      // seekTo() 이후 resume()이 정상 작동하는지로 간접 확인 — started가
      // 변하지 않았다면(이미 true였던 트랙) resume()이 그대로 play()를 부름.
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      player.playFrom(0, 1) // started=true로 만듦
      playMock.mockClear()

      player.seekTo(10, 1)
      player.resume()

      expect(playMock).toHaveBeenCalledTimes(1) // resume()이 정상적으로 play() 호출
    })
  })

  describe('pause()/resume()', () => {
    it('pause() pauses only unlocked tracks', async () => {
      let callCount = 0
      playMock.mockImplementation(() => {
        callCount += 1
        if (callCount === 2) return Promise.reject(new DOMException('', 'NotAllowedError'))
        return Promise.resolve(undefined)
      })
      const player = await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime() // stem_bass(2번째 play() 호출)는 언락 실패
      pauseMock.mockClear()

      player.pause()

      // 언락된 stem_drums만 pause() 호출, 언락 실패한 stem_bass는 건너뜀
      expect(pauseMock).toHaveBeenCalledTimes(1)
    })

    it('resume() calls play() again only on tracks already started via playFrom()', async () => {
      const player = await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime()
      player.playFrom(0, 1) // 둘 다 started=true로 만든다
      playMock.mockClear()
      playMock.mockResolvedValue(undefined)

      player.resume()

      expect(playMock).toHaveBeenCalledTimes(2)
    })

    it('resume() does NOT play a track that was primed but never started via playFrom() (T3-6 모드A 지적 — 카운트인 중 일시정지 회귀)', async () => {
      // 카운트인 중 일시정지→재개를 재현: prime()만 하고 playFrom()은 아직
      // 한 번도 안 부른 상태. resume()이 여기서 play()를 부르면 Transport가
      // 아직 카운트인 중인데도 원곡 오디오가 먼저 들리는 버그가 된다.
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      playMock.mockClear()

      player.resume()

      expect(playMock).not.toHaveBeenCalled()
    })

    it('resume() pauses the element when play() rejects (T3-6 모드A 2라운드 지적)', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      player.playFrom(0, 1) // started=true로 만든다
      playMock.mockClear()
      pauseMock.mockClear()
      playMock.mockRejectedValueOnce(new DOMException('', 'AbortError'))

      player.resume()
      await Promise.resolve().then(() => Promise.resolve())

      expect(pauseMock).toHaveBeenCalledTimes(1)
    })

    it('resume() skips a track that failed to unlock', async () => {
      let callCount = 0
      playMock.mockImplementation(() => {
        callCount += 1
        if (callCount === 2) return Promise.reject(new DOMException('', 'NotAllowedError'))
        return Promise.resolve(undefined)
      })
      const player = await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime() // stem_bass 언락 실패
      playMock.mockClear()
      playMock.mockResolvedValue(undefined)
      player.playFrom(0, 1) // 언락된 stem_drums만 started=true가 됨
      playMock.mockClear()
      playMock.mockResolvedValue(undefined)

      player.resume()

      expect(playMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('setChannelGain() — iOS: T3-12 GainNode 사용(element.volume은 iOS에서 무시됨)', () => {
    it('sets gainNode.gain.value on the matching track only, clamped to [0,1]', async () => {
      stubIOSUserAgent()
      const player = await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime()

      player.setChannelGain('stem_bass', 0.3)

      expect(gainNodes[0].gain.value).toBe(1) // stem_drums는 안 건드림(기본값 유지)
      expect(gainNodes[1].gain.value).toBe(0.3) // stem_bass만 변경
    })

    it('clamps out-of-range gain to [0,1]', async () => {
      stubIOSUserAgent()
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      player.setChannelGain('stem_drums', 1.5)
      expect(gainNodes[0].gain.value).toBe(1)

      player.setChannelGain('stem_drums', -0.5)
      expect(gainNodes[0].gain.value).toBe(0)
    })

    it('silently ignores an unknown kind', async () => {
      stubIOSUserAgent()
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      expect(() => player.setChannelGain('nonexistent', 0.5)).not.toThrow()
    })
  })

  describe('setChannelGain() — T3-16-feedback-3: 데스크톱에서는 element.volume 직접 제어', () => {
    it('sets element.volume on the matching track only, clamped to [0,1]', async () => {
      const player = await createPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime()

      player.setChannelGain('stem_bass', 0.3)

      expect(createdAudioElements[0].volume).toBe(1) // stem_drums는 안 건드림(기본값 유지)
      expect(createdAudioElements[1].volume).toBeCloseTo(0.3) // stem_bass만 변경
    })

    it('clamps out-of-range gain to [0,1]', async () => {
      const player = await createPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      player.setChannelGain('stem_drums', 1.5)
      expect(createdAudioElements[0].volume).toBe(1)

      player.setChannelGain('stem_drums', -0.5)
      expect(createdAudioElements[0].volume).toBe(0)
    })
  })
})

// T6-3(REQ-06, Q-33) — selectStemKinds()는 순수 함수(Tone.js·DOM 의존 없음)라
// 위 createTrackPlayer describe 블록과 별개로 둔다.
describe('selectStemKinds', () => {
  it('strips "original" regardless of stem_music presence', () => {
    expect(selectStemKinds(['original', 'stem_drums'])).toEqual(['stem_drums'])
  })

  it('keeps legacy individual stems when stem_music is absent (하위 호환, 백필 전 곡)', () => {
    expect(
      selectStemKinds(['original', 'stem_drums', 'stem_bass', 'stem_vocals', 'stem_other']),
    ).toEqual(['stem_drums', 'stem_bass', 'stem_vocals', 'stem_other'])
  })

  it('prefers stem_music and drops legacy individual stems when both are present (Codex 모드C C-001 — 5트랙 방지)', () => {
    const result = selectStemKinds([
      'original',
      'stem_drums',
      'stem_bass',
      'stem_vocals',
      'stem_other',
      'stem_music',
    ])
    expect(result).toEqual(['stem_drums', 'stem_music'])
  })

  it('returns an empty list for MIDI-only songs (no stems at all)', () => {
    expect(selectStemKinds(['original'])).toEqual([])
  })
})
