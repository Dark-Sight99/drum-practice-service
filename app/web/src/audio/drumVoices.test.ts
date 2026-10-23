import { describe, expect, it } from 'vitest'
import { velocityToDb } from './drumVoices'

describe('velocityToDb', () => {
  it('maps full velocity to 0dB', () => {
    expect(velocityToDb(1)).toBe(0)
  })

  it('maps zero velocity to -24dB', () => {
    expect(velocityToDb(0)).toBe(-24)
  })

  it('maps half velocity to -12dB (linear midpoint)', () => {
    expect(velocityToDb(0.5)).toBeCloseTo(-12, 5)
  })

  it('clamps out-of-range velocity instead of producing nonsense dB values', () => {
    expect(velocityToDb(1.5)).toBe(0)
    expect(velocityToDb(-0.5)).toBe(-24)
  })
})
