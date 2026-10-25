import { describe, expect, it } from 'vitest'
import {
  CHANNEL_KEYS,
  defaultMixerState,
  effectiveGain,
  isMusicMuted,
  isMusicSolo,
  linearGainToDb,
  musicVolume,
  setMusicMuted,
  setMusicSolo,
  setMusicVolume,
  toggleDrumlessPreset,
  type MixerState,
} from './mixer'

describe('defaultMixerState', () => {
  it('has all 6 channels present, unmuted, not soloed', () => {
    const state = defaultMixerState()
    expect(Object.keys(state).sort()).toEqual([...CHANNEL_KEYS].sort())
    for (const key of CHANNEL_KEYS) {
      expect(state[key].muted).toBe(false)
      expect(state[key].solo).toBe(false)
    }
  })

  it('defaults stem_drums volume to 0 — T3-4 게이트 피드백 2차: 신스 드럼과 겹치지 않게', () => {
    const state = defaultMixerState()
    expect(state.stem_drums.volume).toBe(0)
  })

  it('defaults every other channel to full volume (1)', () => {
    const state = defaultMixerState()
    for (const key of CHANNEL_KEYS) {
      if (key === 'stem_drums') continue
      expect(state[key].volume).toBe(1)
    }
  })
})

describe('effectiveGain — no channel soloed', () => {
  it('returns volume for an unmuted channel', () => {
    const state = defaultMixerState()
    state.stem_bass.volume = 0.6
    expect(effectiveGain(state.stem_bass, state)).toBe(0.6)
  })

  it('returns 0 for a muted channel', () => {
    const state = defaultMixerState()
    state.stem_vocals.muted = true
    expect(effectiveGain(state.stem_vocals, state)).toBe(0)
  })
})

describe('effectiveGain — one channel soloed', () => {
  it('the soloed channel plays at its own volume', () => {
    const state = defaultMixerState()
    state.stem_drums.solo = true
    state.stem_drums.volume = 0.7
    expect(effectiveGain(state.stem_drums, state)).toBe(0.7)
  })

  it('a non-soloed channel is silent regardless of its own muted/volume', () => {
    const state = defaultMixerState()
    state.stem_drums.solo = true
    state.stem_bass.volume = 1
    state.stem_bass.muted = false
    expect(effectiveGain(state.stem_bass, state)).toBe(0)
  })

  it('solo overrides mute on the soloed channel itself (plan.md §2, DAW convention)', () => {
    const state = defaultMixerState()
    state.metronome.solo = true
    state.metronome.muted = true
    state.metronome.volume = 0.9
    expect(effectiveGain(state.metronome, state)).toBe(0.9)
  })
})

describe('effectiveGain — multiple channels soloed', () => {
  it('each soloed channel plays independently at its own volume (no averaging/boost)', () => {
    const state = defaultMixerState()
    state.stem_drums.solo = true
    state.stem_drums.volume = 0.3
    state.synth_drums.solo = true
    state.synth_drums.volume = 0.9
    expect(effectiveGain(state.stem_drums, state)).toBe(0.3)
    expect(effectiveGain(state.synth_drums, state)).toBe(0.9)
  })

  it('channels not among the soloed set stay silent', () => {
    const state = defaultMixerState()
    state.stem_drums.solo = true
    state.synth_drums.solo = true
    expect(effectiveGain(state.stem_bass, state)).toBe(0)
    expect(effectiveGain(state.metronome, state)).toBe(0)
  })
})

describe('effectiveGain — recomputed fresh each time (no transition state needed)', () => {
  it('reverts to the no-solo rule automatically once no channel is soloed', () => {
    const state: MixerState = defaultMixerState()
    state.stem_drums.solo = true
    expect(effectiveGain(state.stem_bass, state)).toBe(0) // 솔로 중엔 무음

    // "마지막 솔로를 끔" — 상태를 그대로 다시 계산만 해도 규칙이 자동 전환됨
    const afterUnsolo: MixerState = { ...state, stem_drums: { ...state.stem_drums, solo: false } }
    expect(effectiveGain(afterUnsolo.stem_bass, afterUnsolo)).toBe(1) // 다시 들림
  })
})

describe('toggleDrumlessPreset', () => {
  it('toggles only stem_drums.volume (0↔1), leaving every other channel untouched', () => {
    const state = defaultMixerState()
    state.synth_drums.volume = 0.5
    state.metronome.solo = true

    const toggled = toggleDrumlessPreset(state)

    expect(toggled.stem_drums.volume).toBe(1) // 기본값 0에서 켜기로 토글
    expect(toggled.stem_bass).toEqual(state.stem_bass)
    expect(toggled.stem_vocals).toEqual(state.stem_vocals)
    expect(toggled.stem_other).toEqual(state.stem_other)
    expect(toggled.synth_drums).toEqual(state.synth_drums)
    expect(toggled.metronome).toEqual(state.metronome)
  })

  it('toggling twice returns stem_drums.volume to its original value (default 0)', () => {
    const state = defaultMixerState()
    const twice = toggleDrumlessPreset(toggleDrumlessPreset(state))
    expect(twice.stem_drums.volume).toBe(0)
  })
})

describe('music 묶음(stem_bass/stem_vocals/stem_other) — T3-4 게이트 피드백 3차', () => {
  describe('musicVolume (대표값)', () => {
    it('returns the average of the 3 stem volumes', () => {
      const state = defaultMixerState()
      state.stem_bass.volume = 0.2
      state.stem_vocals.volume = 0.4
      state.stem_other.volume = 0.6
      expect(musicVolume(state)).toBeCloseTo(0.4, 5)
    })

    it('does not touch stem_drums/synth_drums/metronome', () => {
      const state = defaultMixerState()
      state.stem_drums.volume = 0.9
      state.synth_drums.volume = 0.5
      expect(musicVolume(state)).toBeCloseTo(1, 5) // 기본값 전부 1
    })
  })

  describe('setMusicVolume', () => {
    it('sets the same volume on all 3 stems, leaving other channels untouched', () => {
      const state = defaultMixerState()
      state.synth_drums.volume = 0.3

      const next = setMusicVolume(state, 0.5)

      expect(next.stem_bass.volume).toBe(0.5)
      expect(next.stem_vocals.volume).toBe(0.5)
      expect(next.stem_other.volume).toBe(0.5)
      expect(next.stem_drums).toEqual(state.stem_drums)
      expect(next.synth_drums).toEqual(state.synth_drums)
      expect(next.metronome).toEqual(state.metronome)
    })

    it('normalizes a previously-mixed state to a single value', () => {
      const state = defaultMixerState()
      state.stem_bass.volume = 0.1
      state.stem_vocals.volume = 0.9

      const next = setMusicVolume(state, 0.7)

      expect(next.stem_bass.volume).toBe(0.7)
      expect(next.stem_vocals.volume).toBe(0.7)
      expect(next.stem_other.volume).toBe(0.7)
    })
  })

  describe('isMusicMuted / setMusicMuted', () => {
    it('isMusicMuted is false by default (nothing muted)', () => {
      expect(isMusicMuted(defaultMixerState())).toBe(false)
    })

    it('isMusicMuted is true only when all 3 stems are muted', () => {
      const state = defaultMixerState()
      state.stem_bass.muted = true
      state.stem_vocals.muted = true
      expect(isMusicMuted(state)).toBe(false) // stem_other 아직 안 묶임

      state.stem_other.muted = true
      expect(isMusicMuted(state)).toBe(true)
    })

    it('setMusicMuted(true) mutes all 3 stems, leaving other channels untouched', () => {
      const state = defaultMixerState()
      const next = setMusicMuted(state, true)
      expect(next.stem_bass.muted).toBe(true)
      expect(next.stem_vocals.muted).toBe(true)
      expect(next.stem_other.muted).toBe(true)
      expect(next.stem_drums.muted).toBe(false)
      expect(next.synth_drums.muted).toBe(false)
      expect(next.metronome.muted).toBe(false)
    })

    it('setMusicMuted(false) unmutes all 3 stems even from a mixed state', () => {
      const state = defaultMixerState()
      state.stem_bass.muted = true
      const next = setMusicMuted(state, false)
      expect(next.stem_bass.muted).toBe(false)
      expect(next.stem_vocals.muted).toBe(false)
      expect(next.stem_other.muted).toBe(false)
    })
  })

  describe('isMusicSolo / setMusicSolo', () => {
    it('isMusicSolo is true only when all 3 stems are soloed', () => {
      const state = defaultMixerState()
      state.stem_bass.solo = true
      state.stem_vocals.solo = true
      state.stem_other.solo = true
      expect(isMusicSolo(state)).toBe(true)
    })

    it('setMusicSolo(true) solos all 3 stems together (verified via effectiveGain)', () => {
      const state = defaultMixerState()
      const next = setMusicSolo(state, true)
      // 솔로 규칙(work/T3-4/plan.md §2)과 합성 — 3개가 같이 솔로되면 나머지
      // (드럼 원곡·신스 드럼·메트로놈)는 전부 무음이 됨.
      expect(effectiveGain(next.stem_bass, next)).toBe(next.stem_bass.volume)
      expect(effectiveGain(next.synth_drums, next)).toBe(0)
    })
  })
})

describe('linearGainToDb', () => {
  it('maps unity gain (1.0) to 0dB', () => {
    expect(linearGainToDb(1)).toBe(0)
  })

  it('maps silence (0 or below) to -Infinity', () => {
    expect(linearGainToDb(0)).toBe(-Infinity)
    expect(linearGainToDb(-0.1)).toBe(-Infinity)
  })

  it('maps half gain to approximately -6dB (standard dB halving)', () => {
    expect(linearGainToDb(0.5)).toBeCloseTo(-6.02, 1)
  })
})
