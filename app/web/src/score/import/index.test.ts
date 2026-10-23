import { Midi } from '@tonejs/midi'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { importScoreFile } from './index'

const T0_4_DRUM_TEST = path.resolve(
  import.meta.dirname,
  '../../../../../qa-evidence/T0-4/drum_test.musicxml',
)

function buildMidiBytes(): Uint8Array {
  const midi = new Midi()
  const track = midi.addTrack()
  track.channel = 9
  track.addNote({ midi: 36, ticks: 0, durationTicks: 120, velocity: 1 })
  return midi.toArray()
}

describe('importScoreFile', () => {
  it('routes .mid files to the MIDI importer', () => {
    const result = importScoreFile(buildMidiBytes(), 'my-song.mid')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.score.meta.source).toBe('midi')
  })

  it('routes .musicxml files to the notation importer', () => {
    const bytes = new Uint8Array(readFileSync(T0_4_DRUM_TEST))
    const result = importScoreFile(bytes, 'drum_test.musicxml')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.score.meta.source).toBe('musicxml')
  })

  it('routes .gp5 files to the notation importer with source "gp"', () => {
    // GP 포맷 실제 파일은 없어 손상 입력을 쓰지만, "경로 분기"가 올바른지(ok:false여도
    // importNotationBytes로 갔는지)는 에러 메시지 접두어로 확인한다.
    const garbage = new Uint8Array([1, 2, 3])
    const result = importScoreFile(garbage, 'song.gp5')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('악보 파싱 실패')
  })

  it('rejects unsupported extensions without throwing', () => {
    const result = importScoreFile(new Uint8Array([1, 2, 3]), 'notes.txt')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('지원하지 않는')
  })
})
