import { Midi } from '@tonejs/midi'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { importScoreFile } from './index'

const T0_4_DRUM_TEST = path.resolve(
  import.meta.dirname,
  '../../../../../qa-evidence/T0-4/drum_test.musicxml',
)
// Codex 모드A C-001: GP 경로도 실제 성공 샘플로 검증하라는 지적 — 실제 GP 샘플
// 파일이 없어, T0-4의 검증된 MusicXML을 alphaTab 자신의 Gp7Exporter로 실제
// Guitar Pro 7+ 바이너리로 내보낸 뒤 저장해둔 진짜 .gp 파일(생성 경로는
// work/T2-1/report.md "Codex 모드A 검수 반영" 참고).
const REAL_GP_FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../../../qa-evidence/T2-1/drum_test_roundtrip.gp',
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

  it('generates a correct DrumScore from a real Guitar Pro 7+ file (.gp)', () => {
    const bytes = new Uint8Array(readFileSync(REAL_GP_FIXTURE))
    const result = importScoreFile(bytes, 'drum_test_roundtrip.gp')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.score.meta.source).toBe('gp')
    expect(result.score.notes.map((n) => n.piece)).toEqual([
      'kick',
      'snare',
      'hihat_closed',
      'hihat_closed',
    ])
  })

  it('routes .gp5 corrupt input to the notation importer without throwing', () => {
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
