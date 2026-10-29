import { describe, expect, it } from 'vitest'
import type { DrumScore } from './types'
import { isDrumScore, validateDrumScore } from './validate'

function minimalScore(): DrumScore {
  return {
    version: 1,
    meta: { title: '', bpm: 120, timeSignature: [4, 4], source: 'midi' },
    notes: [],
    ppq: 480,
    audioOffsetMs: 0,
  }
}

describe('validateDrumScore', () => {
  it('accepts a minimal score with no notes', () => {
    const result = validateDrumScore(minimalScore())
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('accepts a score with multiple notes including hand info', () => {
    const score = minimalScore()
    score.notes = [
      { tick: 0, piece: 'kick', velocity: 100, hand: 'RF' },
      { tick: 240, piece: 'snare', velocity: 90, hand: 'L', handSource: 'user' },
      { tick: 480, piece: 'hihat_closed', velocity: 70, hand: null },
    ]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a version other than 1', () => {
    const score = { ...minimalScore(), version: 2 }
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('version: 1이 아님')
  })

  it('rejects an audioOffsetMs at or past one beat length (T3-72, Q-43 — bpm=120의 한 박=500ms)', () => {
    const score = { ...minimalScore(), audioOffsetMs: 500 }
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('audioOffsetMs'))).toBe(true)
  })

  it('rejects a negative audioOffsetMs', () => {
    const score = { ...minimalScore(), audioOffsetMs: -1 }
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('audioOffsetMs'))).toBe(true)
  })

  it('accepts an audioOffsetMs within one beat length (T3-72 — 다운비트 자동 보정이 실제로 채우는 값의 범위)', () => {
    const score = { ...minimalScore(), audioOffsetMs: 280 }
    const result = validateDrumScore(score)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects a non-finite audioOffsetMs', () => {
    const score = { ...minimalScore(), audioOffsetMs: Number.POSITIVE_INFINITY }
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('audioOffsetMs'))).toBe(true)
  })

  it('rejects an unknown meta.source', () => {
    const score = minimalScore()
    // @ts-expect-error 의도적으로 잘못된 값 주입
    score.meta.source = 'cassette_tape'
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('meta.source'))).toBe(true)
  })

  it('rejects ppq <= 0', () => {
    const result = validateDrumScore({ ...minimalScore(), ppq: 0 })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('ppq: 0보다 큰 정수가 아님')
  })

  it('rejects a malformed timeSignature', () => {
    const score = minimalScore()
    // @ts-expect-error 의도적으로 잘못된 값 주입
    score.meta.timeSignature = [4]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('meta.timeSignature'))).toBe(true)
  })

  it('flags only the invalid note and keeps checking the rest (partial recognition, REQ-02)', () => {
    const score = minimalScore()
    score.notes = [
      { tick: 0, piece: 'kick', velocity: 100, hand: null },
      // @ts-expect-error 의도적으로 잘못된 분류 주입(인식 실패 시뮬레이션)
      { tick: 10, piece: 'tambourine', velocity: 100, hand: null },
    ]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('notes[1].piece')
  })

  it('rejects velocity out of 0-127 range', () => {
    const score = minimalScore()
    score.notes = [{ tick: 0, piece: 'kick', velocity: 128, hand: null }]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('notes[0].velocity')
  })

  it('rejects a negative tick', () => {
    const score = minimalScore()
    score.notes = [{ tick: -1, piece: 'kick', velocity: 100, hand: null }]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('notes[0].tick')
  })

  it('rejects a non-integer tick (Codex 모드A C-002)', () => {
    const score = minimalScore()
    score.notes = [{ tick: 1.5, piece: 'kick', velocity: 100, hand: null }]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('notes[0].tick')
  })

  it('rejects a hand value outside R|L|RF|LF|null', () => {
    const score = minimalScore()
    // @ts-expect-error 의도적으로 잘못된 값 주입
    score.notes = [{ tick: 0, piece: 'kick', velocity: 100, hand: 'both' }]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('notes[0].hand')
  })

  it('does not flag handSource when hand is null (no such constraint in spec)', () => {
    const score = minimalScore()
    score.notes = [{ tick: 0, piece: 'kick', velocity: 100, hand: null, handSource: 'auto' }]
    const result = validateDrumScore(score)
    expect(result.valid).toBe(true)
  })

  it('does not crash on completely malformed input', () => {
    expect(validateDrumScore(null)).toEqual({ valid: false, errors: ['DrumScore는 객체여야 함'] })
    expect(validateDrumScore('not an object').valid).toBe(false)
    expect(validateDrumScore(42).valid).toBe(false)
    expect(() => validateDrumScore({ notes: 'not an array' })).not.toThrow()
    expect(validateDrumScore({ notes: 'not an array' }).valid).toBe(false)
  })

  it('does not crash when a note field throws on access (Codex 모드A C-001 회귀)', () => {
    const score = minimalScore()
    score.notes = [
      Object.defineProperty({}, 'piece', {
        get() {
          throw new Error('악의적/손상된 데이터의 getter가 접근 중 예외를 던짐')
        },
        enumerable: true,
      }) as never,
    ]
    let result: ReturnType<typeof validateDrumScore> | undefined
    expect(() => {
      result = validateDrumScore(score)
    }).not.toThrow()
    expect(result?.valid).toBe(false)
  })
})

describe('isDrumScore', () => {
  it('narrows unknown to DrumScore when valid', () => {
    const data: unknown = minimalScore()
    expect(isDrumScore(data)).toBe(true)
  })

  it('returns false for invalid data', () => {
    expect(isDrumScore({ version: 2 })).toBe(false)
  })
})
