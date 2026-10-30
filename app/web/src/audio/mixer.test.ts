import { describe, expect, it } from 'vitest'
import {
  CHANNEL_KEYS,
  defaultMixerState,
  effectiveGain,
  isMusicMuted,
  linearGainToDb,
  METRONOME_BOOST_DB,
  metronomeGainToDb,
  musicVolume,
  normalizeMusicChannels,
  setMusicMuted,
  setMusicVolume,
  STEM_DRUMS_BOOST_DB,
  stemDrumsBoostedGain,
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

  it('끄는 방향(원곡 드럼 켜기)은 신스 드럼 볼륨을 항상 0으로 — 중간값이었어도', () => {
    const state = defaultMixerState()
    state.synth_drums.volume = 0.5 // 사용자가 따로 조절해둔 값

    const toggled = toggleDrumlessPreset(state)

    expect(toggled.synth_drums.volume).toBe(0) // 끄는 쪽은 항상 0 — 복원 대상은 "켜지는" 방향뿐
  })

  it('2026-10-27(의뢰인 요청) — 복원 볼륨을 넘기면 100%가 아니라 그 값으로 되돌아감', () => {
    const state = defaultMixerState()
    state.synth_drums.volume = 1
    const off = toggleDrumlessPreset(state, 0.3) // 원곡 드럼 켜짐 → 신스 드럼 0으로

    const on = toggleDrumlessPreset(off, 0.3) // 다시 꺼짐 → 신스 드럼이 "기억해둔" 0.3으로(1이 아님)

    expect(on.synth_drums.volume).toBe(0.3)
  })

  it('restoreSynthDrumsVolume을 안 넘기면 기존처럼 100%로 복귀(기본값 호환)', () => {
    const state = defaultMixerState()
    const off = toggleDrumlessPreset(state)
    const on = toggleDrumlessPreset(off)
    expect(on.synth_drums.volume).toBe(1)
  })

  it('2026-10-27(의뢰인 추가 지적) — stem_drums도 켜질 때 100%가 아니라 복원 볼륨으로(synth_drums와 대칭)', () => {
    const state = defaultMixerState()
    state.stem_drums.volume = 0.6 // 사용자가 전에 직접 맞춰둔 값
    const off = toggleDrumlessPreset(state, 1, 0.6) // 원곡 드럼 꺼짐 → 0으로(끄기는 항상 0)

    const on = toggleDrumlessPreset(off, 1, 0.6) // 다시 켜짐 → "기억해둔" 0.6으로(1이 아님)

    expect(on.stem_drums.volume).toBe(0.6)
  })

  it('restoreStemDrumsVolume을 안 넘기면 기존처럼 100%로 복귀(기본값 호환)', () => {
    const state = defaultMixerState() // stem_drums: 0(기본, 꺼진 상태)
    const on = toggleDrumlessPreset(state) // 켜짐 — 복원 볼륨 안 넘겼으니 기본값 100%
    expect(on.stem_drums.volume).toBe(1)
  })

  it('끄는 방향(원곡 드럼 끄기)은 stem_drums 볼륨을 항상 0으로 — 복원 대상은 켜지는 쪽뿐', () => {
    const state = defaultMixerState()
    state.stem_drums.volume = 0.7

    const toggled = toggleDrumlessPreset(state, 1, 0.6) // 복원 볼륨을 넘겨도

    expect(toggled.stem_drums.volume).toBe(0) // 끄는 쪽은 항상 0
  })

  it('모드A 지적 회귀 — 꺼짐→다시 켜짐 복귀 시 미리 음소거해둔 채널도 실제로 들리게 함(muted도 같이 리셋)', () => {
    const state = defaultMixerState()
    state.synth_drums.muted = true // 사용자가 미리 M 체크박스로 음소거해둔 상태

    const on = toggleDrumlessPreset(state) // 원곡 드럼 켜짐 → 신스 드럼 volume 0
    const off = toggleDrumlessPreset(on) // 다시 꺼짐 → 신스 드럼 volume 1로 복귀

    expect(off.synth_drums.muted).toBe(false) // muted가 안 풀리면 volume=1이어도 안 들림
    expect(effectiveGain(off.synth_drums)).toBe(1) // 실제로 들리는지까지 확인
  })

  it('모드A 2라운드 의견 — 대칭 케이스: stem_drums를 미리 음소거해둔 경우도 켜질 때 실제로 들림', () => {
    const state = defaultMixerState()
    state.stem_drums.muted = true // 사용자가 미리 M 체크박스로 음소거해둔 상태(기본 volume은 0)

    const on = toggleDrumlessPreset(state) // 원곡 드럼 켜짐 → volume 1로

    expect(on.stem_drums.muted).toBe(false)
    expect(effectiveGain(on.stem_drums)).toBe(1)
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

  describe('normalizeMusicChannels', () => {
    // T6-3(REQ-06, Q-33, Codex 모드A C-001) — 서버 저장 레거시 데이터가
    // stem_bass/vocals/other를 서로 다르게 갖고 있을 때(합쳐진 'stem_music'
    // 트랙에 대표값 하나만 적용하는 코드가 이제 이 셋에 의존하므로), 로드
    // 직후 이 함수로 정규화해야 안전하다는 걸 검증.
    it('leaves an already-consistent state unchanged', () => {
      const state = setMusicVolume(defaultMixerState(), 0.4)
      const result = normalizeMusicChannels(state)
      // 평균 계산(부동소수점)을 거치므로 toBeCloseTo — musicVolume()가 이미
      // 같은 이유로 pytest.approx 상당의 허용오차를 쓰는 패턴과 동일.
      expect(result.stem_bass.volume).toBeCloseTo(0.4)
      expect(result.stem_vocals.volume).toBeCloseTo(0.4)
      expect(result.stem_other.volume).toBeCloseTo(0.4)
    })

    it('averages volume when the 3 legacy values diverge', () => {
      const state = defaultMixerState()
      state.stem_bass.volume = 0.2
      state.stem_vocals.volume = 0.5
      state.stem_other.volume = 0.8
      const result = normalizeMusicChannels(state)
      expect(result.stem_bass.volume).toBeCloseTo(0.5)
      expect(result.stem_vocals.volume).toBeCloseTo(0.5)
      expect(result.stem_other.volume).toBeCloseTo(0.5)
    })

    it('mutes all 3 only when all 3 were already muted (matches isMusicMuted semantics)', () => {
      const partiallyMuted = defaultMixerState()
      partiallyMuted.stem_bass.muted = true
      partiallyMuted.stem_vocals.muted = true
      // stem_other not muted — should NOT count as "music muted"
      const result = normalizeMusicChannels(partiallyMuted)
      expect(result.stem_bass.muted).toBe(false)
      expect(result.stem_vocals.muted).toBe(false)
      expect(result.stem_other.muted).toBe(false)

      const fullyMuted = setMusicMuted(defaultMixerState(), true)
      const resultFullyMuted = normalizeMusicChannels(fullyMuted)
      expect(resultFullyMuted.stem_bass.muted).toBe(true)
      expect(resultFullyMuted.stem_vocals.muted).toBe(true)
      expect(resultFullyMuted.stem_other.muted).toBe(true)
    })

    it('leaves other channels (stem_drums/synth_drums/metronome) untouched', () => {
      const state = defaultMixerState()
      state.stem_drums.volume = 0.6
      state.synth_drums.muted = true
      const result = normalizeMusicChannels(state)
      expect(result.stem_drums.volume).toBe(0.6)
      expect(result.synth_drums.muted).toBe(true)
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

describe('metronomeGainToDb — T3-39(2026-10-27, 의뢰인 요청: 메트로놈이 노래에 묻힘)', () => {
  it('boosts the metronome ceiling by METRONOME_BOOST_DB at unity gain', () => {
    expect(metronomeGainToDb(1)).toBeCloseTo(METRONOME_BOOST_DB, 6)
  })

  it('still scales down proportionally as the slider is lowered', () => {
    expect(metronomeGainToDb(0.5)).toBeCloseTo(linearGainToDb(0.5) + METRONOME_BOOST_DB, 6)
  })

  it('stays -Infinity (silent) at zero gain, not a finite boosted value', () => {
    expect(metronomeGainToDb(0)).toBe(-Infinity)
  })
})

describe('stemDrumsBoostedGain — 2026-10-30(의뢰인 요청: 원곡 드럼이 100%여도 작게 들림)', () => {
  it('부스트는 선형 배율(10^(dB/20))로 곱해진다 — 단위 gain에서 그대로 그 배율', () => {
    expect(stemDrumsBoostedGain(1)).toBeCloseTo(10 ** (STEM_DRUMS_BOOST_DB / 20), 10)
  })

  it('슬라이더를 낮추면 부스트도 비례해서 같이 줄어든다(배율은 고정, 입력에 곱함)', () => {
    expect(stemDrumsBoostedGain(0.5)).toBeCloseTo(0.5 * 10 ** (STEM_DRUMS_BOOST_DB / 20), 10)
  })

  it('0(무음)은 부스트해도 여전히 0', () => {
    expect(stemDrumsBoostedGain(0)).toBe(0)
  })

  it('현재 설정(+12dB)에서 setChannelGain()의 안전 상한(선형 4, +12.04dB)을 넘기지 않는다 — stemPlayer.ts와의 계약', () => {
    expect(stemDrumsBoostedGain(1)).toBeLessThan(4)
  })
})
