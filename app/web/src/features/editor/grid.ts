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

/** 편집기 세로 9행 — 연습 화면의 8레인(render/layout.ts의 LANES, 하이햇 닫힘/열림
 * 공유 1레인)과 달리 정확한 피스 지정이 필요해 하이햇을 별도 행으로 둔다
 * (work/T2-6/plan.md §설계 2, §가정). 순서 자체는 LANES와 완전히 동일하게
 * 맞춘다 — 하이햇 레인이 있던 자리에 닫힘/열림 두 행을 나란히 끼워 넣을 뿐.
 * 2026-10-29(의뢰인 요청) — "편집에 노트위치랑 연주하는곳의 노트위치가 달라서
 * 헷갈릴 수 있을듯... kk의 위치가 서로 달라" — 전엔 KK(킥)가 맨 아래였는데
 * LANES에선 SN 바로 다음이라 위치가 어긋나 있었음(그 외 HT/MT/FT/RD 상대
 * 순서는 원래도 같았음) — T3-60. */
export const EDITOR_ROWS: readonly { piece: DrumPiece; label: string }[] = [
  { piece: 'hihat_closed', label: 'HH(닫힘)' },
  { piece: 'hihat_open', label: 'HH(열림)' },
  { piece: 'crash', label: 'CR' },
  { piece: 'snare', label: 'SN' },
  { piece: 'kick', label: 'KK' },
  { piece: 'tom_high', label: 'HT' },
  { piece: 'tom_mid', label: 'MT' },
  { piece: 'tom_floor', label: 'FT' },
  { piece: 'ride', label: 'RD' },
]

export function editorRowIndexForPiece(piece: DrumPiece): number {
  return EDITOR_ROWS.findIndex((row) => row.piece === piece)
}
