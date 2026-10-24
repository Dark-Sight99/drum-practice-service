// 편집기 격자(피아노롤) 순수 로직. 근거: REQ-03, work/T2-6/plan.md §설계 2.
import type { DrumPiece } from '../../score/types'

/** 4분/8분/16분/8분음표 셋잇단. */
export type GridUnit = '4n' | '8n' | '16n' | '8nt'

const DIVISOR_BY_UNIT: Record<GridUnit, number> = { '4n': 1, '8n': 2, '16n': 4, '8nt': 3 }

/** 격자 한 칸의 틱 수(DrumScore 자신의 ppq 기준). */
export function ticksPerGridUnit(unit: GridUnit, ppq: number): number {
  return ppq / DIVISOR_BY_UNIT[unit]
}

/** 틱을 가장 가까운 격자선으로 반올림(스냅).
 *
 * `ppq`가 격자 분할 수(8분음표 셋잇단은 3)로 나누어떨어지지 않으면(예: ppq=100에
 * '8nt') `ticksPerGridUnit`이 정수가 아닌 값을 반환하고, 그 결과 스냅된 틱도
 * 정수가 아니게 될 수 있다 — `score/validate.ts`는 `note.tick`이 정수가 아니면
 * 거부한다(Codex 모드A 지적, 실제로 재현됨: ppq=100, '8nt'에서 tick=50 →
 * 66.666…). 최종 결과를 한 번 더 반올림해 항상 정수를 반환한다. */
export function snapTick(tick: number, unit: GridUnit, ppq: number): number {
  const step = ticksPerGridUnit(unit, ppq)
  return Math.round(Math.round(tick / step) * step)
}

/** 편집기 세로 9행 — 연습 화면의 8레인(T2-3 LANES, 하이햇 닫힘/열림 공유 1레인)과
 * 달리 정확한 피스 지정이 필요해 하이햇을 별도 행으로 둔다(work/T2-6/plan.md §설계 2,
 * §가정). intent/04-ui-ux.md §3 레인 순서를 그대로 따르되 하이햇만 둘로 나눔. */
export const EDITOR_ROWS: readonly { piece: DrumPiece; label: string }[] = [
  { piece: 'hihat_closed', label: 'HH(닫힘)' },
  { piece: 'hihat_open', label: 'HH(열림)' },
  { piece: 'crash', label: 'CR' },
  { piece: 'snare', label: 'SN' },
  { piece: 'tom_high', label: 'HT' },
  { piece: 'tom_mid', label: 'MT' },
  { piece: 'tom_floor', label: 'FT' },
  { piece: 'ride', label: 'RD' },
  { piece: 'kick', label: 'KK' },
]

export function editorRowIndexForPiece(piece: DrumPiece): number {
  return EDITOR_ROWS.findIndex((row) => row.piece === piece)
}
