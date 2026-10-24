// 레인/킷 렌더러의 순수 좌표·시간 계산(Canvas 의존 없음 — jsdom에서 단위 테스트 가능).
// 근거: REQ-06, intent/04-ui-ux.md §3(레인 순서·낙하·마디/박선),
// intent/08-design.md §3(피스별 모양), work/T2-3/plan.md §설계.
import type { DrumNote, DrumPiece, Hand } from '../score/types'
import {
  barDurationSeconds,
  beatsPerBar,
  secondsPerClick,
  type TimeSignature,
} from '../audio/timing'

export type NoteShape =
  'x' | 'x-ring' | 'x-large' | 'diamond' | 'rounded-rect' | 'circle' | 'circle-large' | 'bar'

export interface LaneDef {
  /** 이 레인에 속하는 DrumPiece(하이햇 닫힘/열림은 한 레인을 공유 — 04-ui-ux.md §3). */
  pieces: DrumPiece[]
  label: string
  shapeByPiece: Partial<Record<DrumPiece, NoteShape>>
}

/** 레인 순서(좌→우, 오른손잡이 기준): 하이햇, 크래시, 스네어, 하이탐, 미드탐, 플로어탐,
 * 라이드, 킥 — intent/04-ui-ux.md §3. */
export const LANES: readonly LaneDef[] = [
  {
    pieces: ['hihat_closed', 'hihat_open'],
    label: 'HH',
    shapeByPiece: { hihat_closed: 'x', hihat_open: 'x-ring' },
  },
  { pieces: ['crash'], label: 'CR', shapeByPiece: { crash: 'x-large' } },
  { pieces: ['snare'], label: 'SN', shapeByPiece: { snare: 'rounded-rect' } },
  { pieces: ['tom_high'], label: 'HT', shapeByPiece: { tom_high: 'circle' } },
  { pieces: ['tom_mid'], label: 'MT', shapeByPiece: { tom_mid: 'circle' } },
  { pieces: ['tom_floor'], label: 'FT', shapeByPiece: { tom_floor: 'circle-large' } },
  { pieces: ['ride'], label: 'RD', shapeByPiece: { ride: 'diamond' } },
  { pieces: ['kick'], label: 'KK', shapeByPiece: { kick: 'bar' } },
]

export function laneIndexForPiece(piece: DrumPiece): number {
  return LANES.findIndex((lane) => lane.pieces.includes(piece))
}

/** 노트 시각을 판정선 기준 Y좌표로 변환. 노트가 아직 안 왔으면(미래) 판정선보다
 * 위(작은 Y), 지나갔으면(과거) 판정선보다 아래(큰 Y) — 위→아래로 떨어지는
 * 리듬게임 관례(intent/04-ui-ux.md §3 "노트 낙하(위→아래)"). */
export function noteYPosition(
  noteTimeSeconds: number,
  currentTimeSeconds: number,
  pixelsPerSecond: number,
  hitLineY: number,
): number {
  const secondsUntilHit = noteTimeSeconds - currentTimeSeconds
  return hitLineY - secondsUntilHit * pixelsPerSecond
}

/** "보이는 마디 수"(1~4, 조절 가능 — 04-ui-ux.md "낙하 속도")를 낙하 속도(px/s)로
 * 환산. 보이는 마디 수가 늘수록(더 멀리 앞까지 보임) 같은 레인 길이에 더 많은
 * 음악 시간을 담아야 하니 1초당 이동 거리는 오히려 줄어든다(픽셀/초 감소 —
 * 화면에서 체감하는 낙하 속도가 느려짐). */
export function pixelsPerSecond(
  laneLengthPx: number,
  barsVisible: number,
  timeSignature: TimeSignature,
  bpm: number,
): number {
  const totalSeconds = barDurationSeconds(timeSignature, bpm) * barsVisible
  return laneLengthPx / totalSeconds
}

/** 매 프레임 전체 노트를 보는 대신, 화면에 보이는 시간 창(판정선 기준 과거
 * lookbehind초 ~ 미래 lookahead초) 안의 노트만 추린다. */
export function visibleNotes(
  notes: readonly DrumNote[],
  noteTimeSeconds: (note: DrumNote) => number,
  currentTimeSeconds: number,
  lookaheadSeconds: number,
  lookbehindSeconds: number,
): DrumNote[] {
  const from = currentTimeSeconds - lookbehindSeconds
  const to = currentTimeSeconds + lookaheadSeconds
  return notes.filter((note) => {
    const t = noteTimeSeconds(note)
    return t >= from && t <= to
  })
}

export interface BarBeatLine {
  timeSeconds: number
  isBar: boolean
}

/** 보이는 시간 창 [windowStartSeconds, windowEndSeconds) 안의 마디선·박선 시각을
 * 생성(마디 시작=마디선, 그 외 박=박선). 끝 경계는 포함하지 않음(반열림 구간) —
 * 연속으로 스크롤되는 다음 프레임의 창과 이어붙일 때 경계선이 중복으로 그려지지
 * 않게 하기 위함. intent/04-ui-ux.md §3 "박/마디선: 레인에 마디선(굵게)·박선
 * (얇게) 표시". */
export function barBeatLines(
  timeSignature: TimeSignature,
  bpm: number,
  windowStartSeconds: number,
  windowEndSeconds: number,
): BarBeatLine[] {
  if (windowEndSeconds <= windowStartSeconds) return []
  const clickSeconds = secondsPerClick(bpm, 4)
  const clicksPerBar = Math.round(beatsPerBar(timeSignature, 4))
  const firstClickIndex = Math.ceil(windowStartSeconds / clickSeconds)
  const lastClickIndex = Math.ceil(windowEndSeconds / clickSeconds) - 1

  const lines: BarBeatLine[] = []
  for (let i = firstClickIndex; i <= lastClickIndex; i++) {
    lines.push({ timeSeconds: i * clickSeconds, isBar: i % clicksPerBar === 0 })
  }
  return lines
}

/** 판정선 근처(±hitWindowSeconds) 노트가 있는 피스 집합 — 킷 점등 트리거.
 * intent/04-ui-ux.md §3 "판정선 도달 시 해당 피스 점등". */
export function activePieces(
  notes: readonly DrumNote[],
  noteTimeSeconds: (note: DrumNote) => number,
  currentTimeSeconds: number,
  hitWindowSeconds: number,
): Set<DrumPiece> {
  const pieces = new Set<DrumPiece>()
  for (const note of notes) {
    const dt = Math.abs(noteTimeSeconds(note) - currentTimeSeconds)
    if (dt <= hitWindowSeconds) pieces.add(note.piece)
  }
  return pieces
}

/** 판정선 근처(±hitWindowSeconds) 노트의 피스별 손/발(REQ-12) — 킷 점등 테두리
 * 실선(R/RF)·점선(L/LF) 트리거. `activePieces`와 같은 조건을 쓰되 손 정보도 함께
 * 돌려준다(work/T2-7/plan.md §설계 3). 같은 피스에 다른 손의 노트가 동시에
 * 판정창에 들어오면 마지막 값만 남음 — `activePieces`의 Set.add와 같은 단순화. */
export function activeHandByPiece(
  notes: readonly DrumNote[],
  noteTimeSeconds: (note: DrumNote) => number,
  currentTimeSeconds: number,
  hitWindowSeconds: number,
): Map<DrumPiece, Hand> {
  const result = new Map<DrumPiece, Hand>()
  for (const note of notes) {
    const dt = Math.abs(noteTimeSeconds(note) - currentTimeSeconds)
    if (dt <= hitWindowSeconds) result.set(note.piece, note.hand)
  }
  return result
}
