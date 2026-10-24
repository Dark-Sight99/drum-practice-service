import { describe, expect, it } from 'vitest'
import { VELOCITY_TIERS, velocityTierOf } from './velocity'

describe('velocityTierOf', () => {
  it('returns the exact tier for its own defined value', () => {
    expect(velocityTierOf(VELOCITY_TIERS.soft)).toBe('soft')
    expect(velocityTierOf(VELOCITY_TIERS.mid)).toBe('mid')
    expect(velocityTierOf(VELOCITY_TIERS.strong)).toBe('strong')
  })

  it('picks the nearest tier for in-between values', () => {
    // soft=40, mid=90, strong=120 — 중간점: (40+90)/2=65, (90+120)/2=105
    expect(velocityTierOf(60)).toBe('soft')
    expect(velocityTierOf(70)).toBe('mid')
    expect(velocityTierOf(100)).toBe('mid')
    expect(velocityTierOf(110)).toBe('strong')
  })

  it('clamps sensibly at the extremes of the MIDI range', () => {
    expect(velocityTierOf(0)).toBe('soft')
    expect(velocityTierOf(127)).toBe('strong')
  })
})
