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
  // 2026-10-31(REQ-02·Q-47) — 백엔드 `api/schemas.py`의 `handSource: HandSource
  // | None = None`과 맞춤. 서버가 `None`(JSON `null`)을 기본값으로 내려주므로
  // (자동 채보 곡은 전부 이 값), 프런트도 `null`을 "손 배정 안 함"(undefined와
  // 동등)으로 받아들여야 한다 — `null`을 거부하면 자동 채보 곡은 수정 한 번
  // 못 하고 저장이 항상 막힌다(실기기 재현으로 확인된 버그).
  handSource?: HandSource | null
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
