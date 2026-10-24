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

/** 고정 'R' 배정 피스들의 우선순위(앞쪽이 높음) — 같은 틱에 둘 이상이 겹치면
 * 우선순위가 낮은 쪽을 'L'로 보낸다. 한 손이 같은 순간 두 악기를 칠 수 없다는
 * 물리적 제약을 반영(T2-11, Phase 2 게이트 4차 피드백 "HH 계속 치면서 SN을 R/L
 * 번갈아 치는 게 물리적으로 가능한가" 질문을 조사하다가, 실제 곡 데이터에서
 * 하이햇·크래시가 같은 틱에 둘 다 'R'로 배정된 사례를 발견해 등록). 하이햇/라이드는
 * 통상 타임키핑을 담당해 손을 유지하고, 크래시는 액센트라 손을 비켜주는 쪽이 더
 * 자연스럽다고 판단했지만 전문 검증은 안 된 휴리스틱(Q-11에 포함). */
const FIXED_HAND_PRIORITY: readonly DrumPiece[] = ['hihat_closed', 'hihat_open', 'ride', 'crash']

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

  // 같은 틱에 하이햇/라이드가 있는지 빠르게 찾기 위한 보조 맵.
  const coincidenceTicks = new Set<number>()
  for (const note of notes) {
    if (COINCIDENCE_TRIGGER_PIECES.includes(note.piece)) coincidenceTicks.add(note.tick)
  }

  // 같은 틱에 고정 'R' 피스가 둘 이상 겹치는지 빠르게 찾기 위한 보조 맵(틱 →
  // 그 틱에 있는 고정 'R' 피스 집합) — T2-11, 위 FIXED_HAND_PRIORITY 설명 참조.
  const fixedHandTicks = new Map<number, Set<DrumPiece>>()
  for (const note of notes) {
    if (!FIXED_HAND_PRIORITY.includes(note.piece)) continue
    const set = fixedHandTicks.get(note.tick) ?? new Set<DrumPiece>()
    set.add(note.piece)
    fixedHandTicks.set(note.tick, set)
  }
  function hasHigherPriorityAtSameTick(piece: DrumPiece, tick: number): boolean {
    const set = fixedHandTicks.get(tick)
    if (!set) return false
    const myRank = FIXED_HAND_PRIORITY.indexOf(piece)
    for (const other of set) {
      if (other !== piece && FIXED_HAND_PRIORITY.indexOf(other) < myRank) return true
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
        pieceRule === 'R' && hasHigherPriorityAtSameTick(note.piece, note.tick) ? 'L' : pieceRule
      result[i] = { ...note, hand, handSource: 'auto' }
      continue
    }

    if (note.piece === 'snare' && coincidenceTicks.has(note.tick)) {
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
