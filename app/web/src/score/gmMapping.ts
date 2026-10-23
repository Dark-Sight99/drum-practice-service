import type { DrumPiece } from './types'

// General MIDI Level 1 Percussion Key Map(채널 10)에서 가져온 노트 번호.
// work/T1-5/plan.md "GM 매핑 값 검증 근거"에서 공식 표와 대조 확인함.
export const PIECE_TO_GM_NOTE: Readonly<Record<DrumPiece, number>> = {
  kick: 36, // Bass Drum 1
  snare: 38, // Acoustic Snare
  hihat_closed: 42, // Closed Hi Hat
  hihat_open: 46, // Open Hi Hat
  tom_high: 50, // High Tom
  tom_mid: 47, // Low-Mid Tom
  tom_floor: 43, // High Floor Tom
  crash: 49, // Crash Cymbal 1
  ride: 51, // Ride Cymbal 1
}

export const GM_NOTE_TO_PIECE: Readonly<Record<number, DrumPiece>> = Object.fromEntries(
  Object.entries(PIECE_TO_GM_NOTE).map(([piece, note]) => [note, piece as DrumPiece]),
)
