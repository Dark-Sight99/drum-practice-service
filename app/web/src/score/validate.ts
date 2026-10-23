import type { DrumPiece, DrumScore, Hand, HandSource, ScoreSource } from './types'

const DRUM_PIECES: readonly DrumPiece[] = [
  'kick',
  'snare',
  'hihat_closed',
  'hihat_open',
  'tom_high',
  'tom_mid',
  'tom_floor',
  'crash',
  'ride',
]

const HANDS: readonly Hand[] = ['R', 'L', 'RF', 'LF', null]
const HAND_SOURCES: readonly HandSource[] = ['auto', 'user']
const SCORE_SOURCES: readonly ScoreSource[] = ['audio', 'omr', 'midi', 'musicxml', 'gp']

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateMeta(meta: unknown, errors: string[]): void {
  if (!isPlainObject(meta)) {
    errors.push('meta: 객체가 아님')
    return
  }
  if (typeof meta.title !== 'string') {
    errors.push('meta.title: 문자열이 아님')
  }
  if (typeof meta.bpm !== 'number' || !Number.isFinite(meta.bpm) || meta.bpm <= 0) {
    errors.push('meta.bpm: 0보다 큰 유한한 숫자가 아님')
  }
  const ts = meta.timeSignature
  if (
    !Array.isArray(ts) ||
    ts.length !== 2 ||
    !ts.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)
  ) {
    errors.push('meta.timeSignature: [양의 정수, 양의 정수] 형태가 아님')
  }
  if (typeof meta.source !== 'string' || !SCORE_SOURCES.includes(meta.source as ScoreSource)) {
    errors.push(`meta.source: ${SCORE_SOURCES.join('|')} 중 하나가 아님`)
  }
}

function validateNote(note: unknown, index: number, errors: string[]): void {
  if (!isPlainObject(note)) {
    errors.push(`notes[${index}]: 객체가 아님`)
    return
  }
  if (typeof note.tick !== 'number' || !Number.isFinite(note.tick) || note.tick < 0) {
    errors.push(`notes[${index}].tick: 0 이상의 유한한 숫자가 아님`)
  }
  if (typeof note.piece !== 'string' || !DRUM_PIECES.includes(note.piece as DrumPiece)) {
    errors.push(`notes[${index}].piece: 유효한 타악기 분류가 아님(${DRUM_PIECES.join('|')})`)
  }
  if (
    typeof note.velocity !== 'number' ||
    !Number.isInteger(note.velocity) ||
    note.velocity < 0 ||
    note.velocity > 127
  ) {
    errors.push(`notes[${index}].velocity: 0~127 범위의 정수가 아님`)
  }
  if (!HANDS.includes(note.hand as Hand)) {
    errors.push(`notes[${index}].hand: R|L|RF|LF|null 중 하나가 아님`)
  }
  if (note.handSource !== undefined && !HAND_SOURCES.includes(note.handSource as HandSource)) {
    errors.push(`notes[${index}].handSource: auto|user 중 하나가 아님`)
  }
}

/** DrumScore 구조·범위를 검사한다. 예외를 던지지 않음 — REQ-02 수용 기준
 * ("인식 실패/부분 인식 시에도 크래시 없이 '인식된 부분 + 편집 필요' 상태로 진입")에
 * 맞춰, 호출자가 항상 에러 목록을 받아 어느 부분이 문제인지 보여줄 수 있게 한다. */
export function validateDrumScore(data: unknown): ValidationResult {
  const errors: string[] = []

  if (!isPlainObject(data)) {
    return { valid: false, errors: ['DrumScore는 객체여야 함'] }
  }

  if (data.version !== 1) {
    errors.push('version: 1이 아님')
  }

  validateMeta(data.meta, errors)

  if (!Array.isArray(data.notes)) {
    errors.push('notes: 배열이 아님')
  } else {
    data.notes.forEach((note: unknown, i: number) => validateNote(note, i, errors))
  }

  if (typeof data.ppq !== 'number' || !Number.isInteger(data.ppq) || data.ppq <= 0) {
    errors.push('ppq: 0보다 큰 정수가 아님')
  }

  if (typeof data.audioOffsetMs !== 'number' || !Number.isFinite(data.audioOffsetMs)) {
    errors.push('audioOffsetMs: 유한한 숫자가 아님')
  }

  return { valid: errors.length === 0, errors }
}

export function isDrumScore(data: unknown): data is DrumScore {
  return validateDrumScore(data).valid
}
