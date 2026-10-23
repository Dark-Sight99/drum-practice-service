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

export type ScoreSource = 'audio' | 'omr' | 'midi' | 'musicxml' | 'gp'

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
