import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { validateDrumScore } from '../validate'
import { importMidiBuffer } from './importMidi'

function buildMidiBytes(build: (midi: Midi) => void): ArrayBuffer {
  const midi = new Midi()
  build(midi)
  return midi.toArray().buffer as ArrayBuffer
}

describe('importMidiBuffer', () => {
  it('converts a percussion track to a valid DrumScore', () => {
    const bytes = buildMidiBytes((midi) => {
      midi.header.setTempo(100)
      const track = midi.addTrack()
      track.channel = 9
      track.addNote({ midi: 36, ticks: 0, durationTicks: 120, velocity: 1 }) // kick
      track.addNote({ midi: 38, ticks: 240, durationTicks: 120, velocity: 0.5 }) // snare
    })

    const result = importMidiBuffer(bytes, '테스트곡')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.score.meta.title).toBe('테스트곡')
    expect(result.score.meta.source).toBe('midi')
    expect(result.score.notes).toHaveLength(2)
    expect(result.score.notes[0]).toMatchObject({ tick: 0, piece: 'kick', velocity: 127 })
    expect(result.score.notes[1]).toMatchObject({ tick: 240, piece: 'snare' })
    expect(result.score.notes[1].velocity).toBeGreaterThanOrEqual(62)
    expect(result.score.notes[1].velocity).toBeLessThanOrEqual(64)
    expect(result.unmappedNoteCount).toBe(0)
    expect(validateDrumScore(result.score)).toEqual({ valid: true, errors: [] })
  })

  it('ignores notes on non-percussion channels', () => {
    const bytes = buildMidiBytes((midi) => {
      const track = midi.addTrack()
      track.channel = 0 // 퍼커션 아님
      track.addNote({ midi: 60, ticks: 0, durationTicks: 120, velocity: 1 })
    })

    const result = importMidiBuffer(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.score.notes).toHaveLength(0)
  })

  it('skips GM percussion notes outside our 9-piece classification and counts them', () => {
    const bytes = buildMidiBytes((midi) => {
      const track = midi.addTrack()
      track.channel = 9
      track.addNote({ midi: 36, ticks: 0, durationTicks: 120, velocity: 1 }) // kick(매핑됨)
      track.addNote({ midi: 56, ticks: 120, durationTicks: 120, velocity: 1 }) // cowbell(매핑 안 됨)
      track.addNote({ midi: 54, ticks: 240, durationTicks: 120, velocity: 1 }) // tambourine(매핑 안 됨)
    })

    const result = importMidiBuffer(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.score.notes).toHaveLength(1)
    expect(result.score.notes[0].piece).toBe('kick')
    expect(result.unmappedNoteCount).toBe(2)
    expect(result.unmappedGmNotes).toEqual([54, 56])
  })

  it('returns a safe failure result for corrupt bytes instead of throwing', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    let result: ReturnType<typeof importMidiBuffer> | undefined
    expect(() => {
      result = importMidiBuffer(garbage)
    }).not.toThrow()
    expect(result?.ok).toBe(false)
  })

  it('falls back to 120bpm/4-4 when the file has no tempo or time signature events', () => {
    const midi = new Midi()
    midi.header.tempos = []
    midi.header.timeSignatures = []
    const track = midi.addTrack()
    track.channel = 9
    track.addNote({ midi: 36, ticks: 0, durationTicks: 120, velocity: 1 })
    const bytes = midi.toArray().buffer as ArrayBuffer

    const result = importMidiBuffer(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.score.meta.bpm).toBe(120)
    expect(result.score.meta.timeSignature).toEqual([4, 4])
  })
})
