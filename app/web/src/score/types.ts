// DrumScore 내부 형식 타입. 근거: intent/03-architecture-stack.md §2, REQ-02.

export type DrumPiece =
  | 'kick'
  | 'snare'
  | 'hihat_closed'
  | 'hihat_open'
  | 'tom_high'
  | 'tom_mid'
  | 'tom_floor'
  | 'crash'
  | 'ride'

export type Hand = 'R' | 'L' | 'RF' | 'LF' | null

export type HandSource = 'auto' | 'user'

// 2026-10-26 — 종이 악보(OMR) 경로 드롭(의뢰인 결정, intent/01-vision.md "2026-10-26
// 갱신" 참고)으로 'omr'은 더 이상 유효한 값이 아님.
export type ScoreSource = 'audio' | 'midi' | 'musicxml' | 'gp'

export interface DrumNote {
  tick: number
  piece: DrumPiece
  velocity: number
  hand: Hand
  handSource?: HandSource
}

export interface DrumScoreMeta {
  title: string
  bpm: number
  timeSignature: [number, number]
  source: ScoreSource
}

export interface DrumScore {
  version: 1
  meta: DrumScoreMeta
  notes: DrumNote[]
  ppq: number
  audioOffsetMs: number
}
