import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateDrumScore } from '../validate'
import { importNotationBytes } from './importNotation'

const T0_4_DRUM_TEST = path.resolve(
  import.meta.dirname,
  '../../../../../qa-evidence/T0-4/drum_test.musicxml',
)
const T0_3_OMR_MXL = path.resolve(
  import.meta.dirname,
  '../../../../../qa-evidence/T0-3/out/IMG_7945.mxl',
)

describe('importNotationBytes (MusicXML, 실제 샘플)', () => {
  it('converts the Phase 0 drum_test.musicxml fixture into the expected DrumScore', () => {
    const bytes = new Uint8Array(readFileSync(T0_4_DRUM_TEST))
    const result = importNotationBytes(bytes, 'musicxml', 'drum_test')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.score.meta.source).toBe('musicxml')
    expect(result.score.meta.bpm).toBe(120)
    expect(result.score.meta.timeSignature).toEqual([4, 4])
    expect(result.score.notes.map((n) => n.piece)).toEqual([
      'kick',
      'snare',
      'hihat_closed',
      'hihat_closed',
    ])
    expect(validateDrumScore(result.score)).toEqual({ valid: true, errors: [] })
  })

  it('does not crash on a real-world .mxl file even without drum content asserted', () => {
    const bytes = new Uint8Array(readFileSync(T0_3_OMR_MXL))
    let result: ReturnType<typeof importNotationBytes> | undefined
    expect(() => {
      result = importNotationBytes(bytes, 'musicxml', 'omr-sample')
    }).not.toThrow()
    expect(result?.ok).toBe(true)
  })

  it('returns a safe failure result for corrupt bytes instead of throwing', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    let result: ReturnType<typeof importNotationBytes> | undefined
    expect(() => {
      result = importNotationBytes(garbage, 'musicxml')
    }).not.toThrow()
    expect(result?.ok).toBe(false)
  })
})
