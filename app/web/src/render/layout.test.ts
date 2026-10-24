import { describe, expect, it } from 'vitest'
import type { DrumNote } from '../score/types'
import {
  activePieces,
  barBeatLines,
  laneIndexForPiece,
  LANES,
  noteYPosition,
  pixelsPerSecond,
  visibleNotes,
} from './layout'

describe('LANES', () => {
  it('has exactly 8 lanes covering all 9 DrumPieces (hihat shares one lane)', () => {
    expect(LANES).toHaveLength(8)
    const allPieces = LANES.flatMap((l) => l.pieces)
    expect(allPieces).toHaveLength(9)
    expect(new Set(allPieces).size).toBe(9)
  })

  it('finds the hihat lane for both closed and open variants', () => {
    const closedIndex = laneIndexForPiece('hihat_closed')
    const openIndex = laneIndexForPiece('hihat_open')
    expect(closedIndex).toBe(openIndex)
    expect(closedIndex).toBeGreaterThanOrEqual(0)
  })

  it('returns -1 for lanes that do not exist (defensive)', () => {
    // @ts-expect-error 의도적으로 존재하지 않는 피스 주입
    expect(laneIndexForPiece('tambourine')).toBe(-1)
  })
})

describe('noteYPosition', () => {
  it('places a note exactly on the hit line when its time equals current time', () => {
    expect(noteYPosition(10, 10, 100, 500)).toBe(500)
  })

  it('places a future note above the hit line (smaller Y)', () => {
    const y = noteYPosition(11, 10, 100, 500) // 1초 후 도착
    expect(y).toBeLessThan(500)
  })

  it('places a past note below the hit line (larger Y)', () => {
    const y = noteYPosition(9, 10, 100, 500) // 1초 전에 지남
    expect(y).toBeGreaterThan(500)
  })
})

describe('pixelsPerSecond', () => {
  it('decreases speed proportionally as more bars become visible (same lane length holds more music)', () => {
    const speed1Bar = pixelsPerSecond(1000, 1, [4, 4], 120)
    const speed2Bar = pixelsPerSecond(1000, 2, [4, 4], 120)
    expect(speed2Bar).toBeCloseTo(speed1Bar / 2, 5)
  })

  it('matches the expected value for 4/4 at 120bpm, 1 bar visible', () => {
    // 1마디(4/4,120bpm)=2초, 레인 길이 1000px -> 500px/s
    expect(pixelsPerSecond(1000, 1, [4, 4], 120)).toBeCloseTo(500, 5)
  })
})

function note(tick: number, piece: DrumNote['piece']): DrumNote {
  return { tick, piece, velocity: 100, hand: null }
}

describe('visibleNotes', () => {
  const notes = [note(0, 'kick'), note(1, 'snare'), note(2, 'crash')]
  const timeOf = (n: DrumNote) => n.tick // 테스트 단순화를 위해 tick을 그대로 "초"로 취급

  it('excludes notes outside the lookahead/lookbehind window', () => {
    const result = visibleNotes(notes, timeOf, 1, 0.5, 0.5)
    expect(result.map((n) => n.piece)).toEqual(['snare'])
  })

  it('includes notes within the window on both sides', () => {
    const result = visibleNotes(notes, timeOf, 1, 1, 1)
    expect(result.map((n) => n.piece)).toEqual(['kick', 'snare', 'crash'])
  })
})

describe('barBeatLines', () => {
  it('generates 1 bar line + 3 beat lines for one 4/4 bar at 120bpm (half-open window)', () => {
    const lines = barBeatLines([4, 4], 120, 0, 2) // [0,2) = 정확히 1마디, 다음 마디 시작(2.0)은 제외
    expect(lines).toHaveLength(4)
    expect(lines.filter((l) => l.isBar)).toHaveLength(1)
    expect(lines.filter((l) => !l.isBar)).toHaveLength(3)
    expect(lines[0]).toEqual({ timeSeconds: 0, isBar: true })
  })

  it('does not duplicate the boundary line across two adjacent windows', () => {
    const first = barBeatLines([4, 4], 120, 0, 2)
    const second = barBeatLines([4, 4], 120, 2, 4)
    const overlap = first.filter((a) => second.some((b) => b.timeSeconds === a.timeSeconds))
    expect(overlap).toEqual([])
  })

  it('returns an empty array for an inverted or empty window', () => {
    expect(barBeatLines([4, 4], 120, 2, 1)).toEqual([])
    expect(barBeatLines([4, 4], 120, 1, 1)).toEqual([])
  })
})

describe('activePieces', () => {
  const notes = [note(0, 'kick'), note(0.5, 'snare')]
  const timeOf = (n: DrumNote) => n.tick

  it('includes only pieces within the hit window', () => {
    const result = activePieces(notes, timeOf, 0.02, 0.05)
    expect(result).toEqual(new Set(['kick']))
  })

  it('returns an empty set when nothing is near the hit line', () => {
    const result = activePieces(notes, timeOf, 5, 0.05)
    expect(result.size).toBe(0)
  })
})
