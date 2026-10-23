import { describe, expect, it } from 'vitest'
import {
  barDurationSeconds,
  beatsPerBar,
  metronomeBeatTimes,
  secondsPerBeat,
  ticksToSeconds,
} from './timing'

describe('secondsPerBeat', () => {
  it('converts common bpm values to quarter-note seconds', () => {
    expect(secondsPerBeat(60)).toBe(1)
    expect(secondsPerBeat(120)).toBe(0.5)
    expect(secondsPerBeat(150)).toBeCloseTo(0.4, 5)
  })
})

describe('ticksToSeconds', () => {
  it('converts one quarter note (ppq ticks) to the expected seconds at 120bpm', () => {
    expect(ticksToSeconds(960, 960, 120)).toBeCloseTo(0.5, 5)
  })

  it('scales linearly with tick count', () => {
    expect(ticksToSeconds(1920, 960, 120)).toBeCloseTo(1, 5)
    expect(ticksToSeconds(0, 960, 120)).toBe(0)
  })

  it('works with a different ppq (e.g. Tone.Transport default 192)', () => {
    expect(ticksToSeconds(192, 192, 120)).toBeCloseTo(0.5, 5)
  })
})

describe('beatsPerBar', () => {
  it('returns the numerator directly for quarter-note subdivision on simple time', () => {
    expect(beatsPerBar([4, 4])).toBe(4)
    expect(beatsPerBar([3, 4])).toBe(3)
  })

  it('doubles for eighth-note subdivision on simple time', () => {
    expect(beatsPerBar([4, 4], 8)).toBe(8)
  })

  it('handles compound time (6/8) correctly for its natural eighth-note pulse', () => {
    expect(beatsPerBar([6, 8], 8)).toBe(6)
  })
})

describe('barDurationSeconds', () => {
  it('matches 4/4 at 120bpm = 2 seconds (count-in reference)', () => {
    expect(barDurationSeconds([4, 4], 120)).toBeCloseTo(2, 5)
  })

  it('matches 6/8 at 120bpm = 1.5 seconds', () => {
    expect(barDurationSeconds([6, 8], 120, 8)).toBeCloseTo(1.5, 5)
  })
})

describe('metronomeBeatTimes', () => {
  it('generates 4 clicks for one 4/4 bar, first accented, evenly spaced', () => {
    const beats = metronomeBeatTimes([4, 4], 120, 1)
    expect(beats).toHaveLength(4)
    expect(beats.map((b) => b.timeSeconds)).toEqual([0, 0.5, 1, 1.5])
    expect(beats.map((b) => b.accent)).toEqual([true, false, false, false])
  })

  it('repeats the accent pattern across multiple bars', () => {
    const beats = metronomeBeatTimes([4, 4], 120, 2)
    expect(beats).toHaveLength(8)
    expect(beats[4].accent).toBe(true) // 두 번째 마디 첫 클릭
    expect(beats[4].timeSeconds).toBeCloseTo(2, 5)
  })

  it('respects a non-zero start offset (e.g. after count-in)', () => {
    const beats = metronomeBeatTimes([4, 4], 120, 1, 4, 2)
    expect(beats[0].timeSeconds).toBeCloseTo(2, 5)
  })

  it('supports eighth-note subdivision', () => {
    const beats = metronomeBeatTimes([4, 4], 120, 1, 8)
    expect(beats).toHaveLength(8)
    expect(beats.map((b) => b.accent)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })
})
