import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrackPlayer } from './trackPlayer'

// jsdom의 HTMLMediaElement.play()는 실제로 "Not implemented"만 찍고 끝나(실제
// 실행으로 확인) 성공/실패 분기를 전혀 재현하지 못한다 — 그래서 prototype의
// play()/pause()를 직접 통제해 트랙별 언락 성공/실패를 의도적으로 만들어
// 검증한다(실제 재생 자체는 이 테스트의 범위 밖 — qa-evidence/T3-3/의 수동
// 실기기 QA로 확인, work/T3-3/plan.md §QA계획 1).

describe('createTrackPlayer', () => {
  let playMock: ReturnType<typeof vi.fn>
  let pauseMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    playMock = vi.fn().mockResolvedValue(undefined)
    pauseMock = vi.fn()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(playMock)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pauseMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

    it('resume() calls play() again only on unlocked tracks', async () => {
      const player = createTrackPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime()
      playMock.mockClear()
      playMock.mockResolvedValue(undefined)

      player.resume()

      expect(playMock).toHaveBeenCalledTimes(2)
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

      player.resume()

      expect(playMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('setChannelGain()', () => {
    it('sets .volume on the matching track only, clamped to [0,1]', async () => {
      const player = createTrackPlayer([
        { kind: 'stem_drums', url: 'http://x/drums.wav' },
        { kind: 'stem_bass', url: 'http://x/bass.wav' },
      ])
      await player.prime()
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set')
      setSpy.mockClear()

      player.setChannelGain('stem_bass', 0.3)

      expect(setSpy).toHaveBeenCalledTimes(1)
      expect(setSpy).toHaveBeenCalledWith(0.3)
    })

    it('clamps out-of-range gain to [0,1]', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()
      const setSpy = vi.spyOn(HTMLMediaElement.prototype, 'volume', 'set')
      setSpy.mockClear()

      player.setChannelGain('stem_drums', 1.5)
      expect(setSpy).toHaveBeenCalledWith(1)

      setSpy.mockClear()
      player.setChannelGain('stem_drums', -0.5)
      expect(setSpy).toHaveBeenCalledWith(0)
    })

    it('silently ignores an unknown kind', async () => {
      const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
      await player.prime()

      expect(() => player.setChannelGain('nonexistent', 0.5)).not.toThrow()
    })
  })
})
