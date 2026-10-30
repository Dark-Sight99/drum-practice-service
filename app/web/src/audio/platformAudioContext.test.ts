import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// T6-5 — ensureIOSAudioContextSampleRate()는 모듈 스코프 `configured` 플래그로
// "앱 수명 동안 단 한 번"을 보장하므로, 테스트마다 깨끗한 상태로 시작하려면
// vi.resetModules() 후 동적 import로 모듈 인스턴스를 새로 받아야 한다(Vitest 공식
// 패턴 — resetModules()는 모듈 레지스트리만 비우고 vi.mock() 팩토리 등록 자체는
// 유지됨). setContext 스파이는 vi.hoisted()로 모듈 리셋과 무관하게 같은 참조를
// 유지(trackPlayer.test.ts와 동일한 이유).
const { setContextMock } = vi.hoisted(() => ({ setContextMock: vi.fn() }))
vi.mock('tone', () => ({
  setContext: setContextMock,
}))

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

function stubUserAgent(ua: string): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}

beforeEach(() => {
  setContextMock.mockClear()
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isIOS', () => {
  it('iPhone UA면 true', async () => {
    stubUserAgent(IOS_USER_AGENT)
    const { isIOS } = await import('./platformAudioContext')
    expect(isIOS()).toBe(true)
  })

  it('데스크톱 UA면 false', async () => {
    stubUserAgent(DESKTOP_USER_AGENT)
    const { isIOS } = await import('./platformAudioContext')
    expect(isIOS()).toBe(false)
  })
})

describe('ensureIOSAudioContextSampleRate', () => {
  it('iOS면 44100Hz AudioContext로 Tone.setContext()를 호출한다', async () => {
    stubUserAgent(IOS_USER_AGENT)
    const ctorSpy = vi.fn(function (this: unknown, options?: { sampleRate?: number }) {
      ;(this as { sampleRate?: number }).sampleRate = options?.sampleRate
    })
    vi.stubGlobal('AudioContext', ctorSpy)

    const { ensureIOSAudioContextSampleRate } = await import('./platformAudioContext')
    ensureIOSAudioContextSampleRate()

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(ctorSpy).toHaveBeenCalledWith({ sampleRate: 44100 })
    expect(setContextMock).toHaveBeenCalledTimes(1)
  })

  it('iOS가 아니면 AudioContext를 만들지도, setContext를 호출하지도 않는다', async () => {
    stubUserAgent(DESKTOP_USER_AGENT)
    const ctorSpy = vi.fn()
    vi.stubGlobal('AudioContext', ctorSpy)

    const { ensureIOSAudioContextSampleRate } = await import('./platformAudioContext')
    ensureIOSAudioContextSampleRate()

    expect(ctorSpy).not.toHaveBeenCalled()
    expect(setContextMock).not.toHaveBeenCalled()
  })

  it('두 번째 호출은 아무 일도 하지 않는다(멱등)', async () => {
    stubUserAgent(IOS_USER_AGENT)
    const ctorSpy = vi.fn(function (this: unknown, options?: { sampleRate?: number }) {
      ;(this as { sampleRate?: number }).sampleRate = options?.sampleRate
    })
    vi.stubGlobal('AudioContext', ctorSpy)

    const { ensureIOSAudioContextSampleRate } = await import('./platformAudioContext')
    ensureIOSAudioContextSampleRate()
    ensureIOSAudioContextSampleRate()

    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(setContextMock).toHaveBeenCalledTimes(1)
  })

  it('AudioContext 생성이 실패하면 조용히 넘어가고(throw 안 함), 이후 재시도가 가능하다(Codex C-002)', async () => {
    stubUserAgent(IOS_USER_AGENT)
    let callCount = 0
    const ctorSpy = vi.fn(function (this: unknown, options?: { sampleRate?: number }) {
      callCount += 1
      if (callCount === 1) throw new Error('이 기기는 44100Hz를 지원 안 함')
      ;(this as { sampleRate?: number }).sampleRate = options?.sampleRate
    })
    vi.stubGlobal('AudioContext', ctorSpy)

    const { ensureIOSAudioContextSampleRate } = await import('./platformAudioContext')
    expect(() => ensureIOSAudioContextSampleRate()).not.toThrow()
    expect(setContextMock).not.toHaveBeenCalled()

    // 실패 후에도 configured가 false로 남아있어 재시도가 가능해야 함(C-002 반영).
    ensureIOSAudioContextSampleRate()
    expect(ctorSpy).toHaveBeenCalledTimes(2)
    expect(setContextMock).toHaveBeenCalledTimes(1)
  })
})
