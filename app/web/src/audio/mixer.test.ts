import { describe, expect, it } from 'vitest'
import {
  CHANNEL_KEYS,
  defaultMixerState,
  effectiveGain,
  isMusicMuted,
  linearGainToDb,
  musicVolume,
  setMusicMuted,
  setMusicVolume,
  toggleDrumlessPreset,
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

describe('effectiveGain — T3-8(2026-10-25, 의뢰인 요청)로 솔로 제거, muted/volume만 봄', () => {
  it('returns volume for an unmuted channel', () => {
    const state = defaultMixerState()
    state.stem_bass.volume = 0.6
    expect(effectiveGain(state.stem_bass)).toBe(0.6)
  })

  it('returns 0 for a muted channel', () => {
    const state = defaultMixerState()
    state.stem_vocals.muted = true
    expect(effectiveGain(state.stem_vocals)).toBe(0)
  })

  it('ignores a lingering solo:true from legacy saved data (무해화 — S 체크박스가 이제 없어 사용자가 끌 방법이 없으므로 반드시 무시해야 함)', () => {
    const state = defaultMixerState()
    state.stem_drums.solo = true // 과거 저장된 값이라고 가정
    state.stem_drums.volume = 0.8
    state.stem_bass.volume = 0.5 // 솔로가 살아있었다면 무음이었을 채널
    expect(effectiveGain(state.stem_drums)).toBe(0.8)
    expect(effectiveGain(state.stem_bass)).toBe(0.5) // 솔로 무시 — 정상적으로 들림
  })
})

describe('toggleDrumlessPreset — T3-8(2026-10-25, 의뢰인 요청): 신스 드럼도 반대로 자동 전환', () => {
  it('turning stem_drums ON mutes(0) synth_drums, leaving stems/metronome untouched', () => {
    const state = defaultMixerState()
    state.metronome.muted = true

    const toggled = toggleDrumlessPreset(state)

    expect(toggled.stem_drums.volume).toBe(1) // 기본값 0에서 켜기로 토글
    expect(toggled.synth_drums.volume).toBe(0) // 자동으로 꺼짐 — "버튼 두 번 안 눌러도 됨"
    expect(toggled.stem_bass).toEqual(state.stem_bass)
    expect(toggled.stem_vocals).toEqual(state.stem_vocals)
    expect(toggled.stem_other).toEqual(state.stem_other)
    expect(toggled.metronome).toEqual(state.metronome)
  })

  it('toggling twice returns both stem_drums and synth_drums to their original values', () => {
    const state = defaultMixerState() // stem_drums:0, synth_drums:1
    const twice = toggleDrumlessPreset(toggleDrumlessPreset(state))
    expect(twice.stem_drums.volume).toBe(0)
    expect(twice.synth_drums.volume).toBe(1)
  })

  it('overwrites a custom synth_drums volume with the auto-toggled 0/1 value', () => {
    const state = defaultMixerState()
    state.synth_drums.volume = 0.5 // 사용자가 따로 조절해둔 값

    const toggled = toggleDrumlessPreset(state)

    expect(toggled.synth_drums.volume).toBe(0) // 중간값 보존 안 함 — 의도된 동작
  })

  it('모드A 지적 회귀 — 꺼짐→다시 켜짐 복귀 시 미리 음소거해둔 채널도 실제로 들리게 함(muted도 같이 리셋)', () => {
    const state = defaultMixerState()
    state.synth_drums.muted = true // 사용자가 미리 M 체크박스로 음소거해둔 상태

    const on = toggleDrumlessPreset(state) // 원곡 드럼 켜짐 → 신스 드럼 volume 0
    const off = toggleDrumlessPreset(on) // 다시 꺼짐 → 신스 드럼 volume 1로 복귀

    expect(off.synth_drums.muted).toBe(false) // muted가 안 풀리면 volume=1이어도 안 들림
    expect(effectiveGain(off.synth_drums)).toBe(1) // 실제로 들리는지까지 확인
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
