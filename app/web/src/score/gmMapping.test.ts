import { describe, expect, it } from 'vitest'
import { GM_NOTE_TO_PIECE, PIECE_TO_GM_NOTE } from './gmMapping'
import type { DrumPiece } from './types'

const PIECES: DrumPiece[] = [
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

describe('PIECE_TO_GM_NOTE', () => {
  it('maps all 9 minimum classification pieces (REQ-02)', () => {
    for (const piece of PIECES) {
      expect(typeof PIECE_TO_GM_NOTE[piece]).toBe('number')
    }
  })

  it('matches the official General MIDI Level 1 percussion key map', () => {
    // 근거: work/T1-5/plan.md "GM 매핑 값 검증 근거"에서 공식 표와 대조 확인
    expect(PIECE_TO_GM_NOTE.kick).toBe(36)
    expect(PIECE_TO_GM_NOTE.snare).toBe(38)
    expect(PIECE_TO_GM_NOTE.hihat_closed).toBe(42)
    expect(PIECE_TO_GM_NOTE.hihat_open).toBe(46)
    expect(PIECE_TO_GM_NOTE.tom_high).toBe(50)
    expect(PIECE_TO_GM_NOTE.tom_mid).toBe(47)
    expect(PIECE_TO_GM_NOTE.tom_floor).toBe(43)
    expect(PIECE_TO_GM_NOTE.crash).toBe(49)
    expect(PIECE_TO_GM_NOTE.ride).toBe(51)
  })
})

describe('GM_NOTE_TO_PIECE', () => {
  it('is the exact inverse of PIECE_TO_GM_NOTE (1:1 양방향 매핑)', () => {
    for (const piece of PIECES) {
      const note = PIECE_TO_GM_NOTE[piece]
      expect(GM_NOTE_TO_PIECE[note]).toBe(piece)
    }
    expect(Object.keys(GM_NOTE_TO_PIECE)).toHaveLength(PIECES.length)
  })
})
