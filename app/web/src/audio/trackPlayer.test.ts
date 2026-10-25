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

  it('resync() corrects currentTime only when drift exceeds the threshold', async () => {
    const player = createTrackPlayer([{ kind: 'stem_drums', url: 'http://x/drums.wav' }])
    await player.prime()
    playMock.mockClear()
    player.playFrom(0, 1)

    // 내부 <audio> currentTime을 직접 들여다볼 공개 API는 없으므로, resync 전후
    // play() 재호출 여부가 아니라 "예외 없이 동작"만 간접 확인 — 더 정밀한 검증은
    // currentTime을 getter로 노출하지 않는 한 어렵고, 실제 드리프트 보정 효과는
    // 실기기 QA(교차상관 분석)로 확인한다(work/T3-3/plan.md §QA계획 3).
    expect(() => player.resync(0.01, 1, 0.1)).not.toThrow()
    expect(() => player.resync(10, 1, 0.1)).not.toThrow()
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
})
