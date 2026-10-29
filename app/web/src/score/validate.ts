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
const SCORE_SOURCES: readonly ScoreSource[] = ['audio', 'midi', 'musicxml', 'gp']

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
  if (typeof note.tick !== 'number' || !Number.isInteger(note.tick) || note.tick < 0) {
    errors.push(`notes[${index}].tick: 0 이상의 정수가 아님`)
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

function runChecks(data: Record<string, unknown>, errors: string[]): void {
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

  // T3-72(REQ-02, intent/07-open-questions.md Q-43) — 예전엔 "0이어야 함"
  // (T2-8, Q-23, Phase 3 오디오-MIDI 정렬 UI 전까지 임시 제한)이었는데,
  // 이제 서버의 다운비트 자동 보정이 이 필드를 실제로 채운다(work/T3-72/
  // plan.md §6). 설계가 보장하는 범위("다운비트 위상은 항상 0 이상, 한
  // 박 길이 미만")와 정확히 일치시켜, 그 범위를 벗어나는 값은 지금
  // 설계가 만들어낼 수 없는 상태이므로 여전히 거부한다(완전 개방 아님).
  if (typeof data.audioOffsetMs !== 'number' || !Number.isFinite(data.audioOffsetMs)) {
    errors.push('audioOffsetMs: 유한한 숫자가 아님')
  } else if (isPlainObject(data.meta) && typeof data.meta.bpm === 'number' && data.meta.bpm > 0) {
    const periodMs = 60000 / data.meta.bpm
    if (data.audioOffsetMs < 0 || data.audioOffsetMs >= periodMs) {
      errors.push(`audioOffsetMs: 0 이상, 한 박 길이(${periodMs.toFixed(3)}ms) 미만이어야 함`)
    }
  }
  // meta.bpm 자체가 유효하지 않으면(위 validateMeta가 이미 그 에러를 넣었음)
  // 범위를 판단할 기준이 없어 이 검사는 건너뛴다 — 이중 에러 방지.
}

/** DrumScore 구조·범위를 검사한다. 예외를 던지지 않음 — REQ-02 수용 기준
 * ("인식 실패/부분 인식 시에도 크래시 없이 '인식된 부분 + 편집 필요' 상태로 진입")에
 * 맞춰, 호출자가 항상 에러 목록을 받아 어느 부분이 문제인지 보여줄 수 있게 한다.
 *
 * Codex 모드A C-001(재현됨): 필드 접근 중 예외를 던지는 값(예: getter가 던지는
 * 객체)이 섞여 있으면 검사 로직 자체가 예외를 던질 수 있었음 — 전체를 try/catch로
 * 감싸 "절대 던지지 않는다"는 보장을 입력 형태와 무관하게 지킨다. */
export function validateDrumScore(data: unknown): ValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, errors: ['DrumScore는 객체여야 함'] }
  }

  const errors: string[] = []
  try {
    runChecks(data, errors)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { valid: false, errors: [`검증 중 예상치 못한 오류: ${message}`] }
  }

  return { valid: errors.length === 0, errors }
}

export function isDrumScore(data: unknown): data is DrumScore {
  return validateDrumScore(data).valid
}
