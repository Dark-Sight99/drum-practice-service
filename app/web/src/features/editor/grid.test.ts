import { describe, expect, it } from 'vitest'
import type { DrumPiece } from '../../score/types'
import { EDITOR_ROWS, editorRowIndexForPiece, snapTick, ticksPerGridUnit } from './grid'

describe('ticksPerGridUnit', () => {
  it('computes ticks for each grid unit at ppq=480', () => {
    expect(ticksPerGridUnit('4n', 480)).toBe(480)
    expect(ticksPerGridUnit('8n', 480)).toBe(240)
    expect(ticksPerGridUnit('16n', 480)).toBe(120)
    expect(ticksPerGridUnit('8nt', 480)).toBeCloseTo(160, 5)
  })
})

describe('snapTick', () => {
  it('snaps to the nearest grid line', () => {
    expect(snapTick(10, '8n', 480)).toBe(0) // 240 단위, 10은 0에 더 가까움
    expect(snapTick(130, '8n', 480)).toBe(240) // 130은 240에 더 가까움
    expect(snapTick(120, '8n', 480)).toBe(240) // 정확히 중간 — Math.round는 위로
  })

  it('leaves an already-aligned tick unchanged', () => {
    expect(snapTick(960, '8n', 480)).toBe(960)
    expect(snapTick(0, '16n', 480)).toBe(0)
  })

  it('always returns an integer tick even when ppq is not evenly divisible by the grid divisor (Codex 모드A 지적)', () => {
    // ppq=100, '8nt'(÷3) → ticksPerGridUnit = 33.333…, 스냅 결과도 정수가 아닐 수
    // 있었음(score/validate.ts는 정수가 아닌 tick을 거부).
    const result = snapTick(50, '8nt', 100)
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('EDITOR_ROWS / editorRowIndexForPiece', () => {
  const ALL_PIECES: DrumPiece[] = [
    'kick',
    'snare',
    'hihat_closed',
    'hihat_open',
    'tom_high',
    'tom_mid',
    'tom_floor',
    'crash',
    'ride',
  ]

  it('covers every DrumPiece exactly once across all rows (2026-10-29부터 HH는 한 행이 닫힘/열림 둘을 공유)', () => {
    const rowPieces = EDITOR_ROWS.flatMap((r) => r.pieces)
    expect(rowPieces).toHaveLength(ALL_PIECES.length)
    expect(new Set(rowPieces).size).toBe(ALL_PIECES.length)
    for (const piece of ALL_PIECES) {
      expect(rowPieces).toContain(piece)
    }
  })

  it('finds the correct row index for a piece', () => {
    const idx = editorRowIndexForPiece('snare')
    expect(EDITOR_ROWS[idx]?.pieces).toContain('snare')
  })

  it('finds the same HH row for both hihat_closed and hihat_open (연주 화면과 같은 1행 공유)', () => {
    expect(editorRowIndexForPiece('hihat_closed')).toBe(editorRowIndexForPiece('hihat_open'))
  })

  it('returns -1 for an unknown piece (type-cast to simulate bad data)', () => {
    expect(editorRowIndexForPiece('not_a_piece' as DrumPiece)).toBe(-1)
  })
})
