import { describe, expect, it } from 'vitest'
import {
  audioTrackPositionSeconds,
  barDurationSeconds,
  barIndexForSeconds,
  barIndexForTick,
  beatsPerBar,
  computePlaybackSchedule,
  metronomeBeatTimes,
  secondsPerBeat,
  ticksPerBar,
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

describe('ticksPerBar', () => {
  it('matches 4/4 at 960 ppq (one bar = 4 quarter notes)', () => {
    expect(ticksPerBar([4, 4], 960)).toBe(3840)
  })

  it('matches 6/8 — bar length is independent of ppq resolution, expressed in quarter-note-equivalent ticks', () => {
    // beatsPerBar([6,8], 4) = 6 * (4/8) = 3 quarter notes per bar
    expect(ticksPerBar([6, 8], 960)).toBe(2880)
  })
})

describe('barIndexForTick', () => {
  it('tick 0 is bar 0', () => {
    expect(barIndexForTick(0, [4, 4], 960)).toBe(0)
  })

  it('a tick exactly at a bar boundary belongs to the new bar, not the previous one', () => {
    const oneBar = 4 * 960 // 4/4 at 960 ppq
    expect(barIndexForTick(oneBar, [4, 4], 960)).toBe(1)
    expect(barIndexForTick(oneBar - 1, [4, 4], 960)).toBe(0)
  })

  it('works across multiple bars', () => {
    const oneBar = 4 * 960
    expect(barIndexForTick(oneBar * 4 + 10, [4, 4], 960)).toBe(4)
  })
})

describe('barIndexForSeconds — T3-9(REQ-04) "지금 위치"를 A-B 루프 마디로 변환', () => {
  it('position exactly at songStartSeconds is bar 0', () => {
    expect(barIndexForSeconds(10, 10, 2)).toBe(0)
  })

  it('a position exactly at a bar boundary belongs to the new bar, not the previous one', () => {
    expect(barIndexForSeconds(12, 10, 2)).toBe(1) // 10 + 1*2
    expect(barIndexForSeconds(11.999, 10, 2)).toBe(0)
  })

  it('mid-bar position floors to the containing bar', () => {
    expect(barIndexForSeconds(17.5, 10, 2)).toBe(3) // (17.5-10)/2 = 3.75 → 3
  })

  it('clamps to 0 when position is before songStartSeconds (count-in)', () => {
    expect(barIndexForSeconds(3, 10, 2)).toBe(0)
  })

  it('defends against barSeconds <= 0', () => {
    expect(barIndexForSeconds(20, 10, 0)).toBe(0)
    expect(barIndexForSeconds(20, 10, -1)).toBe(0)
  })

  it('defends against NaN/Infinity inputs', () => {
    expect(barIndexForSeconds(NaN, 10, 2)).toBe(0)
    expect(barIndexForSeconds(20, 10, Infinity)).toBe(0)
    expect(barIndexForSeconds(Infinity, 10, 2)).toBe(0)
  })
})

describe('computePlaybackSchedule', () => {
  it('no loop: playback starts at 0, song starts after count-in, loop fields are null', () => {
    const schedule = computePlaybackSchedule([4, 4], 120, 1)
    expect(schedule.playbackStartSeconds).toBe(0)
    expect(schedule.songStartSeconds).toBeCloseTo(2, 5) // 1 bar at 120bpm 4/4 = 2s
    expect(schedule.loopStartSeconds).toBeNull()
    expect(schedule.loopEndSeconds).toBeNull()
  })

  it('loop starting at bar 0 matches the no-loop case exactly', () => {
    const noLoop = computePlaybackSchedule([4, 4], 120, 1)
    const loopFromStart = computePlaybackSchedule([4, 4], 120, 1, { startBar: 0, endBar: 4 })
    expect(loopFromStart.playbackStartSeconds).toBeCloseTo(noLoop.playbackStartSeconds, 5)
    expect(loopFromStart.songStartSeconds).toBeCloseTo(noLoop.songStartSeconds, 5)
  })

  it('loop starting mid-song skips ahead: playback starts right before the loop, not at bar 0', () => {
    const schedule = computePlaybackSchedule([4, 4], 120, 1, { startBar: 8, endBar: 12 })
    // songStart(2s) + 8 bars * 2s/bar = 18s
    expect(schedule.loopStartSeconds).toBeCloseTo(18, 5)
    expect(schedule.loopEndSeconds).toBeCloseTo(26, 5)
    // count-in plays for exactly 1 bar right before the loop starts, not from the song's beginning
    expect(schedule.playbackStartSeconds).toBeCloseTo(16, 5)
    expect(schedule.playbackStartSeconds).toBeGreaterThan(0)
  })

  it('stays well-defined at BPM range boundaries (50%/150% of a typical 120bpm song)', () => {
    expect(() => computePlaybackSchedule([4, 4], 60, 1, { startBar: 0, endBar: 4 })).not.toThrow()
    expect(() => computePlaybackSchedule([4, 4], 180, 1, { startBar: 0, endBar: 4 })).not.toThrow()
    const slow = computePlaybackSchedule([4, 4], 60, 1, { startBar: 2, endBar: 6 })
    expect(slow.loopEndSeconds! > slow.loopStartSeconds!).toBe(true)
  })
})

describe('audioTrackPositionSeconds', () => {
  // T3-3(REQ-04, work/T3-3/plan.md §4) — scorePlayer.ts의 노트 스케줄 식에서
  // 직접 유도. 모드C 1라운드에서 "루프 재진입마다 0으로 틀던" 설계 오류를 이
  // 일반식으로 고쳤으므로, 루프가 0마디부터가 아닌 경우를 반드시 회귀로 둔다.

  it('is zero exactly at song start regardless of playback rate', () => {
    expect(audioTrackPositionSeconds(2, 2, 1)).toBe(0)
    expect(audioTrackPositionSeconds(2, 2, 2.5)).toBe(0)
  })

  it('at rate 1 (practice bpm == original bpm), position equals elapsed transport time', () => {
    expect(audioTrackPositionSeconds(5, 2, 1)).toBeCloseTo(3, 5)
  })

  it('scales elapsed time by playbackRate (2x speed halves the original-file duration elapsed)', () => {
    // 1초 경과(연습 BPM 기준) * 2배속 = 원곡 파일에서는 2초 지점
    expect(audioTrackPositionSeconds(3, 2, 2)).toBeCloseTo(2, 5)
    // 0.6배속(느리게): 1초 경과해도 원곡 파일에서는 0.6초만 지나감
    expect(audioTrackPositionSeconds(3, 2, 0.6)).toBeCloseTo(0.6, 5)
  })

  it('loop re-entry at a non-zero bar must NOT collapse to 0 (regression for the 모드C 1라운드 bug)', () => {
    // 8마디 곡에서 4~6마디를 루프: songStartSeconds=2(1마디 카운트인, 120bpm),
    // loopStartSeconds = songStart + 4마디*2s/마디 = 10초.
    const songStartSeconds = 2
    const loopStartSeconds = 10
    const playbackRate = 1
    const position = audioTrackPositionSeconds(loopStartSeconds, songStartSeconds, playbackRate)
    expect(position).toBeCloseTo(8, 5) // 4마디*2s/마디 — 0이면 안 됨
    expect(position).not.toBe(0)
  })

  it('is consistent with ticksToSeconds: a note scheduled via songStartSeconds+ticksToSeconds(…,playbackBpm) maps back to ticksToSeconds(…,originalBpm) in the audio file', () => {
    const ppq = 960
    const tick = 1920 // 2 quarter notes in
    const originalBpm = 100
    const playbackBpm = 130 // 130% 연습 속도
    const songStartSeconds = 1.5
    const playbackRate = playbackBpm / originalBpm

    const noteTransportSeconds = songStartSeconds + ticksToSeconds(tick, ppq, playbackBpm)
    const audioFilePositionSeconds = audioTrackPositionSeconds(
      noteTransportSeconds,
      songStartSeconds,
      playbackRate,
    )
    const expectedOriginalFilePositionSeconds = ticksToSeconds(tick, ppq, originalBpm)
    expect(audioFilePositionSeconds).toBeCloseTo(expectedOriginalFilePositionSeconds, 10)
  })
})
