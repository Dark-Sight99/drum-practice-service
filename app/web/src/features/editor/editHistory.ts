// 스냅샷 기반 실행취소/다시실행. 근거: REQ-03 "실행취소/다시실행(20단계 이상)",
// work/T2-6/plan.md §설계 2(Codex 모드C C-003 — 상한 100으로 메모리 보호).

export const MAX_HISTORY = 100

export interface EditHistory<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

export function createHistory<T>(initial: T): EditHistory<T> {
  return { past: [], present: initial, future: [] }
}

/** 새 상태를 기록한다 — redo 스택은 비운다(새 편집이 일어나면 "다시실행" 경로는
 * 더 이상 유효하지 않음, 일반적인 undo/redo 관례). past가 MAX_HISTORY를 넘으면
 * 가장 오래된 항목을 버린다. */
export function pushHistory<T>(history: EditHistory<T>, next: T): EditHistory<T> {
  const past = [...history.past, history.present]
  const trimmedPast = past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past
  return { past: trimmedPast, present: next, future: [] }
}

export function undo<T>(history: EditHistory<T>): EditHistory<T> {
  if (history.past.length === 0) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: EditHistory<T>): EditHistory<T> {
  if (history.future.length === 0) return history
  const [next, ...rest] = history.future
  return { past: [...history.past, history.present], present: next, future: rest }
}

export function canUndo<T>(history: EditHistory<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: EditHistory<T>): boolean {
  return history.future.length > 0
}
