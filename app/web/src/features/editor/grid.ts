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

/** 편집기 세로 8행 — render/layout.ts의 LANES와 순서·구성 모두 동일하게
 * 맞춘다(하이햇 닫힘/열림을 한 행으로 공유). work/T2-6/plan.md §설계 2
 * 작성 당시엔 "정확한 피스 지정이 필요해 하이햇을 별도 행으로 둔다"고
 * 판단했었는데, 2026-10-29(의뢰인 재지적) — "hh(열림)삭제 hh(닫힘)대신 HH만
 * 써 연습레인엔 그 구분이 없으니까" — 연주 화면과 시각적으로 다르면 오히려
 * 헷갈린다는 쪽이 맞다고 보고 뒤집음(T3-64). 열림/닫힘 구분 자체(채보에
 * 꼭 필요한 정보)는 없어지지 않음 — 한 행 안에서 노트를 선택했을 때 보이는
 * "닫힘/열림" 전환 버튼(EditorScreen.tsx)으로 옮겼을 뿐.
 * 2026-10-29(의뢰인 요청, 같은 날 이전) — "편집에 노트위치랑 연주하는곳의
 * 노트위치가 달라서 헷갈릴 수 있을듯... kk의 위치가 서로 달라" — 전엔
 * KK(킥)가 맨 아래였는데 LANES에선 SN 바로 다음이라 위치가 어긋나 있었음
 * (그 외 HT/MT/FT/RD 상대 순서는 원래도 같았음) — T3-60. */
export const EDITOR_ROWS: readonly { pieces: readonly DrumPiece[]; label: string }[] = [
  { pieces: ['hihat_closed', 'hihat_open'], label: 'HH' },
  { pieces: ['crash'], label: 'CR' },
  { pieces: ['snare'], label: 'SN' },
  { pieces: ['kick'], label: 'KK' },
  { pieces: ['tom_high'], label: 'HT' },
  { pieces: ['tom_mid'], label: 'MT' },
  { pieces: ['tom_floor'], label: 'FT' },
  { pieces: ['ride'], label: 'RD' },
]

export function editorRowIndexForPiece(piece: DrumPiece): number {
  return EDITOR_ROWS.findIndex((row) => row.pieces.includes(piece))
}
