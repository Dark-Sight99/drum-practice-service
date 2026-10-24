// 스티킹(R/L/RF/LF) 자동 추천 규칙 — 순수 함수. 근거: REQ-12, work/T2-7/plan.md §설계 1.
import type { DrumNote, DrumPiece, Hand } from './types'

export const DEFAULT_START_HAND: 'R' | 'L' = 'R'

/** 필인(연속 스네어/탐)으로 묶는 최대 틱 간격 — 16분음표 간격 이내(ppq를 이 값으로
 * 나눔)면 같은 구간으로 본다. REQ-12 "규칙은 코드 상수로 분리해 수정 가능하게". */
export const FILL_RUN_MAX_GAP_DIVISOR = 4

/** 피스별 고정 손/발 — work/T2-7/plan.md §가정: "하이햇 페달→LF"는 현재 9종
 * DrumPiece 분류에 대상이 없어(Q-22) 포함하지 않는다. */
export const STICKING_PIECE_RULES: Partial<Record<DrumPiece, 'R' | 'RF'>> = {
  kick: 'RF',
  hihat_closed: 'R',
  hihat_open: 'R',
  ride: 'R',
  crash: 'R',
}

const COINCIDENCE_TRIGGER_PIECES: readonly DrumPiece[] = ['hihat_closed', 'hihat_open', 'ride']
const FILL_PIECES: readonly DrumPiece[] = ['snare', 'tom_high', 'tom_mid', 'tom_floor']

/** 고정 'R' 배정 피스들의 우선순위(앞쪽이 높음) — 같은 틱(또는 "거의 동시"로 볼
 * 허용폭 이내)에 둘 이상이 겹치면 우선순위가 낮은 쪽을 'L'로 보낸다. 한 손이
 * 같은 순간 두 악기를 칠 수 없다는 물리적 제약을 반영(T2-11, Phase 2 게이트 4차
 * 피드백 "HH 계속 치면서 SN을 R/L 번갈아 치는 게 물리적으로 가능한가" 질문을
 * 조사하다가, 실제 곡 데이터에서 하이햇·크래시가 같은 틱에 둘 다 'R'로 배정된
 * 사례를 발견해 등록).
 *
 * 크래시가 하이햇보다 우선(T2-17, Phase 2 게이트 의뢰인 확인, 2026-10-25) —
 * 애초 "하이햇 유지·크래시가 비킴" 가정은 전문 검증 안 된 휴리스틱이었는데,
 * 의뢰인이 실제 정석은 반대라고 지적: 크래시는 통상 라이드와 가까운 오른쪽에
 * 있어 오른손이 그대로 닿고, 하이햇은 왼쪽에 있어 왼손으로 넘기는 쪽이 자연스러움
 * — 크래시가 하이햇보다 우선순위가 높아야 한다(하이햇+크래시 동시타 시 하이햇이
 * 'L'로 밀려남). 라이드 vs 크래시 우선순위는 의뢰인이 명시적으로 언급하지 않아
 * 기존 순서(라이드가 높음, 물리적으로도 같은 오른쪽이라 크게 문제되지 않음)를
 * 그대로 유지 — 여전히 전문 검증 안 된 휴리스틱(Q-11). */
const FIXED_HAND_PRIORITY: readonly DrumPiece[] = ['ride', 'crash', 'hihat_closed', 'hihat_open']

/** "거의 동시"로 볼 틱 허용폭 — ppq를 이 값으로 나눔. T2-11에선 정확히 같은 틱만
 * 검사했는데, 의뢰인이 제공한 실제 화면에서 하이햇·크래시가 겨우 4틱(이 곡
 * 기준 약 9ms) 떨어진 서로 다른 틱인데도 둘 다 'R'로 남아있는 사례를 지적
 * (T2-12, Phase 2 게이트 5차 피드백) — "정확히 같은 틱"이라는 조건이 너무 좁아
 * 사실상 동시인 근접 틱을 놓쳤다. ppq/16(120bpm·ppq=220 기준 약 31ms)은
 * REQ-04의 ±30ms 동기 허용 오차와 비슷한 크기로 골랐지만, 초당 틱 수는 BPM에
 * 따라 달라져 정확히 고정된 ms값은 아니다 — 전문 검증 안 된 휴리스틱(Q-11). */
const SIMULTANEOUS_TICK_TOLERANCE_DIVISOR = 16

function simultaneousToleranceTicks(ppq: number): number {
  return ppq / SIMULTANEOUS_TICK_TOLERANCE_DIVISOR
}

function otherHand(hand: 'R' | 'L'): 'R' | 'L' {
  return hand === 'R' ? 'L' : 'R'
}

function fillRunMaxGapTicks(ppq: number): number {
  return ppq / FILL_RUN_MAX_GAP_DIVISOR
}

/** 틱 오름차순으로 정렬된 인덱스 목록을 반환 — 원래 배열 순서를 보존한 채 계산만
 * 틱 순서로 하기 위함(입력이 이미 틱순이라는 가정에 기대지 않음). */
function orderByTick<T extends { tick: number }>(items: readonly T[]): number[] {
  return items.map((_, i) => i).sort((a, b) => items[a].tick - items[b].tick)
}

/** 노트 전체에 자동 추천 손/발을 계산한다. 입력과 같은 순서·길이의 배열을
 * 반환하며, `handSource === 'user'`인 노트는 그대로 통과한다(REQ-12 "자동 결과보다
 * 사용자가 직접 지정한 값이 항상 우선, 재분석해도 덮어쓰지 않음" — 이 함수를 몇 번
 * 다시 불러도 user 값은 안 바뀐다). */
export function recommendSticking(
  notes: readonly DrumNote[],
  ppq: number,
  startHand: 'R' | 'L' = DEFAULT_START_HAND,
): DrumNote[] {
  const order = orderByTick(notes)
  const maxGap = fillRunMaxGapTicks(ppq)
  const simulTol = simultaneousToleranceTicks(ppq)

  // 하이햇/라이드가 있는 틱들(정확히 같은 틱이 아니라도 허용폭 이내면 "동시"로
  // 본다 — T2-12, 아래 SIMULTANEOUS_TICK_TOLERANCE_DIVISOR 설명 참조) 정렬된
  // 배열로 보관 — 실제로는 호출마다 처음부터 선형 탐색한다(Codex 모드A 지적,
  // "이분 탐색"이라던 이전 설명이 실제 구현과 달랐음). 한 곡의 하이햇/라이드
  // 개수가 수백 개 수준이라 당장 성능 문제는 아니라고 판단해 그대로 둠 — 더
  // 커지면 lower-bound 이분 탐색으로 바꿀 여지를 남겨둔다.
  const coincidenceTicksSorted = notes
    .filter((n) => COINCIDENCE_TRIGGER_PIECES.includes(n.piece))
    .map((n) => n.tick)
    .sort((a, b) => a - b)
  function hasCoincidenceWithinTolerance(tick: number): boolean {
    return coincidenceTicksSorted.some((t) => Math.abs(t - tick) <= simulTol)
  }

  // 고정 'R' 피스가 둘 이상 "거의 동시"에 겹치는지 찾기 위한 보조 배열(틱 오름차순
  // {tick, piece} 목록) — T2-11, 위 FIXED_HAND_PRIORITY 설명 참조. 사용자가 직접
  // 'R'이 아닌 손으로 지정한 노트는 그 틱에서 'R'을 쥐고 있지 않으므로 제외한다 —
  // 안 그러면(Codex 모드A 지적) 사용자가 하이햇을 'L'로 직접 바꿔놔도 그 틱의
  // 크래시가 "하이햇이 R을 쥐고 있다"고 잘못 보고 'L'로 밀려나, 실제로는 비어
  // 있는 'R' 대신 하이햇과 크래시가 둘 다 'L'로 겹치는 새 충돌을 만들 수 있었다.
  const fixedHandNotes = notes
    .filter((n) => FIXED_HAND_PRIORITY.includes(n.piece) && !(n.handSource === 'user' && n.hand !== 'R'))
    .map((n) => ({ tick: n.tick, piece: n.piece }))
    .sort((a, b) => a.tick - b.tick)
  // 이 루프도 위 hasCoincidenceWithinTolerance와 마찬가지로 호출마다 배열 처음부터
  // 선형 탐색한다(윈도우 밖(이전 틱) 항목은 continue로 건너뛰지만 매번 처음부터
  // 다시 지나간다는 뜻 — 인덱스를 기억해 재사용하지 않음). 고정 'R' 피스 개수가
  // 한 곡에 수백 개 수준이라 당장은 문제 아니라고 판단.
  function hasHigherPriorityWithinTolerance(piece: DrumPiece, tick: number): boolean {
    const myRank = FIXED_HAND_PRIORITY.indexOf(piece)
    for (const entry of fixedHandNotes) {
      if (entry.tick < tick - simulTol) continue
      if (entry.tick > tick + simulTol) break
      if (entry.piece !== piece && FIXED_HAND_PRIORITY.indexOf(entry.piece) < myRank) return true
    }
    return false
  }

  const result = new Array<DrumNote>(notes.length)

  // 필인 구간(스네어/탐) 위치 계산 — 간격이 maxGap 이하인 연속 구간마다 0부터
  // 다시 센다. user로 고정된 노트도 구간 멤버로는 포함해 간격 계산에 쓰되,
  // 그 노트 자체의 교대 배정에는 쓰지 않는다(plan.md §설계 1).
  let fillPosition = 0
  let prevFillTick: number | null = null

  for (const i of order) {
    const note = notes[i]

    if (note.handSource === 'user') {
      result[i] = note
      if (FILL_PIECES.includes(note.piece)) {
        fillPosition = prevFillTick !== null && note.tick - prevFillTick <= maxGap ? fillPosition + 1 : 0
        prevFillTick = note.tick
      }
      continue
    }

    const pieceRule = STICKING_PIECE_RULES[note.piece]
    if (pieceRule !== undefined) {
      // 고정 'R' 피스끼리 같은 틱에 겹치면(예: 하이햇+크래시 동시타) 한 손이
      // 동시에 두 악기를 칠 수 없으므로 우선순위가 낮은 쪽을 'L'로 보낸다
      // (T2-11 — 'RF'인 킥은 발이라 손 충돌과 무관, 검사 대상 아님).
      const hand =
        pieceRule === 'R' && hasHigherPriorityWithinTolerance(note.piece, note.tick) ? 'L' : pieceRule
      result[i] = { ...note, hand, handSource: 'auto' }
      continue
    }

    if (note.piece === 'snare' && hasCoincidenceWithinTolerance(note.tick)) {
      result[i] = { ...note, hand: 'L', handSource: 'auto' }
      if (FILL_PIECES.includes(note.piece)) {
        fillPosition = prevFillTick !== null && note.tick - prevFillTick <= maxGap ? fillPosition + 1 : 0
        prevFillTick = note.tick
      }
      continue
    }

    if (FILL_PIECES.includes(note.piece)) {
      fillPosition = prevFillTick !== null && note.tick - prevFillTick <= maxGap ? fillPosition + 1 : 0
      prevFillTick = note.tick
      const hand: Hand = fillPosition % 2 === 0 ? startHand : otherHand(startHand)
      result[i] = { ...note, hand, handSource: 'auto' }
      continue
    }

    // 안전망 — 현재 9종 DrumPiece는 전부 위에서 처리되므로 실제로는 도달하지
    // 않지만, 향후 피스가 추가돼도 크래시 없이 미지정으로 둔다.
    result[i] = { ...note, hand: null, handSource: undefined }
  }

  return result
}

/** 선택된 노트 여러 개에 "RLRL 교대"/"LRLR 교대"를 일괄 적용(REQ-12 편집). 입력
 * 순서를 유지해 반환하되 계산은 틱 순서로 한다. 사용자의 명시적 행동이므로
 * 결과는 항상 `handSource: 'user'`(기존 user 값이 있어도 이번 지정이 새 지정). */
export function alternateHandsByTick(notes: readonly DrumNote[], startHand: 'R' | 'L'): DrumNote[] {
  const order = orderByTick(notes)
  const rankOf = new Map<number, number>()
  order.forEach((originalIndex, rank) => rankOf.set(originalIndex, rank))

  return notes.map((note, i) => {
    const rank = rankOf.get(i) ?? 0
    const hand: Hand = rank % 2 === 0 ? startHand : otherHand(startHand)
    return { ...note, hand, handSource: 'user' }
  })
}
