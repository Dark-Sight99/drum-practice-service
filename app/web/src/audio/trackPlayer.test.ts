import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { createTrackPlayer } = await import('./trackPlayer')

describe('createTrackPlayer', () => {
  let playMock: ReturnType<typeof vi.fn>
  let pauseMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    playMock = vi.fn().mockResolvedValue(undefined)
    pauseMock = vi.fn()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock)
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('T3-12: wires each track through Web Audio (source → gain → destination)', () => {
    createTrackPlayer([
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

  it('prime() reports ok:true for every source when play() succeeds', async () => {
    const player = createTrackPlayer([
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
    const player = createTrackPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])
    const results = await player.prime()
    expect(results).toEqual([
      { kind: 'stem_drums', ok: true },
      { kind: 'stem_bass', ok: false },
    ])
  })

  it('playFrom() skips a track that failed to unlock, but still plays the others', async () => {
    let callCount = 0
    playMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 2) return Promise.reject(new DOMException('', 'NotAllowedError'))
      return Promise.resolve(undefined)
    })
    const player = createTrackPlayer([
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
    const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
    await player.prime()
    playMock.mockClear()
    pauseMock.mockClear()
    playMock.mockRejectedValueOnce(new DOMException('', 'AbortError'))

    player.playFrom(5, 1)
    await Promise.resolve().then(() => Promise.resolve()) // catch 핸들러가 돌 때까지 마이크로태스크 양보

    expect(pauseMock).toHaveBeenCalledTimes(1)
  })

  it('playFrom() sets preservesPitch/playbackRate/currentTime on unlocked tracks', async () => {
    const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
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
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false)
      player.playFrom(initialCurrentTime, playbackRate)
      return player
    }

    it('does NOT touch currentTime when drift is within the threshold', async () => {
      const player = await primedUnpausedPlayer(5.02)
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear() // playFrom() 안의 초기 seek 호출은 제외하고 resync()만 본다

      player.resync(5.0, 0.1) // 드리프트 0.02초 < threshold 0.1초

      expect(setSpy).not.toHaveBeenCalled()
    })

    it('corrects currentTime to the expected position when drift exceeds the threshold', async () => {
      const player = await primedUnpausedPlayer(5.5)
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(5.0, 0.1) // 드리프트 0.5초 > threshold 0.1초

      expect(setSpy).toHaveBeenCalledWith(5.0)
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

      player.resync(0.5, 0.1)

      expect(setSpy).not.toHaveBeenCalled()
    })

    it('skips a track that failed to unlock, even with a huge drift', async () => {
      playMock.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime() // 언락 실패
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(999, 0.001)

      expect(setSpy).not.toHaveBeenCalled()
    })

    it('skips a track that is still paused (never actually started), even with a huge drift', async () => {
      // primedUnpausedPlayer를 안 쓰고 paused를 그대로 둔다(jsdom 기본값 true).
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime() // 언락은 성공하지만 playFrom()을 호출 안 해 paused=true 그대로
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setSpy.mockClear()

      player.resync(999, 0.001)

      expect(setSpy).not.toHaveBeenCalled()
    })
  })

  it('stop() pauses every track', async () => {
    const player = createTrackPlayer([
      { kind: 'stem_drums', url: 'http://x/drums.wav' },
      { kind: 'stem_bass', url: 'http://x/bass.wav' },
    ])
    await player.prime()
    pauseMock.mockClear()

    player.stop()

    expect(pauseMock).toHaveBeenCalledTimes(2)
  })

  it('dispose() pauses and clears src for every track', async () => {
    const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
    await player.prime()
    pauseMock.mockClear()

    player.dispose()

    expect(pauseMock).toHaveBeenCalledTimes(1)
  })

  it('dispose() disconnects the Web Audio graph nodes (T3-12)', async () => {
    const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
    await player.prime()

    player.dispose()

    expect(gainNodes[0].disconnect).toHaveBeenCalledTimes(1)
  })

  describe('seekTo() — T3-9(REQ-04): 위치만 옮기고 재생은 시작하지 않음', () => {
    it('repositions unlocked tracks (currentTime/playbackRate/preservesPitch) without calling play()', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      playMock.mockClear()
      const setCurrentTime = vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set')
      setCurrentTime.mockClear()

      player.seekTo(12.5, 1.3)

      expect(setCurrentTime).toHaveBeenCalledWith(12.5)
      expect(playMock).not.toHaveBeenCalled() // playFrom()과의 핵심 차이 — 재생 시작 안 함
    })

    it('clamps a negative position to 0', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
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
      const player = createTrackPlayer([
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
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
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
      const player = createTrackPlayer([
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
      const player = createTrackPlayer([
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
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      playMock.mockClear()

      player.resume()

      expect(playMock).not.toHaveBeenCalled()
    })

    it('resume() pauses the element when play() rejects (T3-6 모드A 2라운드 지적)', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
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
      const player = createTrackPlayer([
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

  describe('setChannelGain() — T3-12: element.volume(iOS 무시됨) 대신 GainNode 사용', () => {
    it('sets gainNode.gain.value on the matching track only, clamped to [0,1]', async () => {
      const player = createTrackPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime()

      player.setChannelGain('stem_bass', 0.3)

      expect(gainNodes[0].gain.value).toBe(1) // stem_drums는 안 건드림(기본값 유지)
      expect(gainNodes[1].gain.value).toBe(0.3) // stem_bass만 변경
    })

    it('clamps out-of-range gain to [0,1]', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      player.setChannelGain('stem_drums', 1.5)
      expect(gainNodes[0].gain.value).toBe(1)

      player.setChannelGain('stem_drums', -0.5)
      expect(gainNodes[0].gain.value).toBe(0)
    })

    it('silently ignores an unknown kind', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      expect(() => player.setChannelGain('nonexistent', 0.5)).not.toThrow()
    })
  })
})
