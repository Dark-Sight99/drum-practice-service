import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, createHistory, MAX_HISTORY, pushHistory, redo, undo } from './editHistory'

describe('editHistory', () => {
  it('starts with no undo/redo available', () => {
    const h = createHistory(0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe(0)
  })

  it('undo restores the previous state, redo moves forward again', () => {
    let h = createHistory(0)
    h = pushHistory(h, 1)
    h = pushHistory(h, 2)
    expect(h.present).toBe(2)

    h = undo(h)
    expect(h.present).toBe(1)
    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)

    h = redo(h)
    expect(h.present).toBe(1)
    h = redo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(false)
  })

  it('pushing a new state after undo clears the redo stack', () => {
    let h = createHistory(0)
    h = pushHistory(h, 1)
    h = pushHistory(h, 2)
    h = undo(h) // present = 1, future = [2]
    expect(canRedo(h)).toBe(true)

    h = pushHistory(h, 99)
    expect(h.present).toBe(99)
    expect(canRedo(h)).toBe(false)
  })

  it('undo/redo on an empty stack is a no-op, not a crash', () => {
    const h = createHistory('x')
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('supports at least 20 consecutive undos (REQ-03 수용 기준)', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 25; i++) h = pushHistory(h, i)
    expect(h.present).toBe(25)

    for (let i = 0; i < 25; i++) h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
  })

  it('caps the past stack at MAX_HISTORY, dropping the oldest snapshot', () => {
    let h = createHistory(0)
    for (let i = 1; i <= MAX_HISTORY + 10; i++) h = pushHistory(h, i)
    expect(h.past).toHaveLength(MAX_HISTORY)
    // 가장 오래된 10개(0~9)는 버려지고 10부터 남아있어야 함
    expect(h.past[0]).toBe(10)
    expect(h.present).toBe(MAX_HISTORY + 10)
  })
})
