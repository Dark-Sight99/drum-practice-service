import type { DrumScore } from '../types'

export type ImportResult =
  | { ok: true; score: DrumScore; unmappedNoteCount: number; unmappedGmNotes: number[] }
  | { ok: false; error: string }
