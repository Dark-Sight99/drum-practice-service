import { describe, expect, it } from 'vitest'
import type { DrumNote } from './types'
import { alternateHandsByTick, recommendSticking } from './sticking'

function note(tick: number, piece: DrumNote['piece'], extra: Partial<DrumNote> = {}): DrumNote {
  return { tick, piece, velocity: 100, hand: null, ...extra }
}

const PPQ = 480 // 16분음표 구간 임계값 = 480/4 = 120틱

describe('recommendSticking', () => {
  it('assigns fixed hand/foot per piece rule', () => {
    const result = recommendSticking(
      [note(0, 'kick'), note(0, 'hihat_closed'), note(240, 'ride'), note(480, 'crash')],
      PPQ,
    )
    expect(result.map((n) => n.hand)).toEqual(['RF', 'R', 'R', 'R'])
    expect(result.every((n) => n.handSource === 'auto')).toBe(true)
  })

  it('demotes the lower-priority fixed-R piece to L when two coincide at the same tick', () => {
    // T2-11 — 한 손이 같은 순간 두 악기를 칠 수 없음: 하이햇+크래시가 같은 틱이면
    // 우선순위 낮은 크래시가 L로 밀려남(FIXED_HAND_PRIORITY).
    const result = recommendSticking([note(0, 'hihat_closed'), note(0, 'crash')], PPQ)
    expect(result.find((n) => n.piece === 'hihat_closed')?.hand).toBe('R')
    expect(result.find((n) => n.piece === 'crash')?.hand).toBe('L')
  })

  it('keeps both hands distinct when ride and crash coincide (ride outranks crash)', () => {
    const result = recommendSticking([note(0, 'crash'), note(0, 'ride')], PPQ)
    expect(result.find((n) => n.piece === 'ride')?.hand).toBe('R')
    expect(result.find((n) => n.piece === 'crash')?.hand).toBe('L')
  })

  it('does not demote a coincident piece because of a higher-priority piece the user moved off R', () => {
    // Codex 모드A 지적(T2-11) — 사용자가 하이햇을 'L'로 직접 지정해놨으면 그 틱의
    // 'R'은 비어 있으므로, 같은 틱 크래시는 'R'을 그대로 유지해야 한다(하이햇이
    // 여전히 'R'을 쥐고 있다고 잘못 보고 크래시까지 'L'로 밀어, 하이햇·크래시가
    // 둘 다 'L'로 겹치는 새 충돌을 만들면 안 됨).
    const result = recommendSticking(
      [note(0, 'hihat_closed', { hand: 'L', handSource: 'user' }), note(0, 'crash')],
      PPQ,
    )
    expect(result.find((n) => n.piece === 'hihat_closed')?.hand).toBe('L')
    expect(result.find((n) => n.piece === 'crash')?.hand).toBe('R')
  })

  it('recommends L for a snare that coincides with hihat/ride at the same tick', () => {
    const result = recommendSticking([note(0, 'hihat_closed'), note(0, 'snare')], PPQ)
    const snare = result.find((n) => n.piece === 'snare')
    expect(snare?.hand).toBe('L')
  })

  it('alternates hands within a fill run (gap within threshold), starting at startHand', () => {
    const notes = [note(0, 'snare'), note(100, 'tom_high'), note(200, 'snare'), note(300, 'tom_mid')]
    const result = recommendSticking(notes, PPQ, 'R')
    expect(result.map((n) => n.hand)).toEqual(['R', 'L', 'R', 'L'])
  })

  it('restarts the alternation when the gap exceeds the threshold', () => {
    const notes = [note(0, 'snare'), note(100, 'snare'), note(1000, 'snare')] // 1000-100=900 > 120
    const result = recommendSticking(notes, PPQ, 'R')
    expect(result.map((n) => n.hand)).toEqual(['R', 'L', 'R'])
  })

  it('defaults an isolated snare/tom hit (no run) to startHand', () => {
    const result = recommendSticking([note(0, 'snare'), note(5000, 'tom_floor')], PPQ, 'L')
    expect(result.map((n) => n.hand)).toEqual(['L', 'L'])
  })

  it('honors a custom startHand of L for fill alternation', () => {
    const notes = [note(0, 'snare'), note(100, 'snare')]
    const result = recommendSticking(notes, PPQ, 'L')
    expect(result.map((n) => n.hand)).toEqual(['L', 'R'])
  })

  it('never overwrites a note whose handSource is "user", even on repeated calls', () => {
    const notes = [note(0, 'snare', { hand: 'L', handSource: 'user' }), note(100, 'snare')]
    const first = recommendSticking(notes, PPQ)
    expect(first[0].hand).toBe('L')
    expect(first[0].handSource).toBe('user')
    const second = recommendSticking(first, PPQ)
    expect(second[0].hand).toBe('L')
    expect(second[0].handSource).toBe('user')
  })

  it('still advances the fill position past a user-locked note for its neighbors', () => {
    // 가운데 노트가 user로 L 고정이어도, 그 다음 노트의 교대 위치는 구간 내
    // 순서(0,1,2)를 그대로 따른다 — 고정된 값 자체를 건너뛸 뿐.
    const notes = [
      note(0, 'snare'),
      note(100, 'snare', { hand: 'L', handSource: 'user' }),
      note(200, 'snare'),
    ]
    const result = recommendSticking(notes, PPQ, 'R')
    expect(result[0].hand).toBe('R')
    expect(result[1].hand).toBe('L') // user 값 그대로
    expect(result[2].hand).toBe('R') // 위치 2 → startHand
  })

  it('preserves input order in the returned array regardless of tick order', () => {
    const notes = [note(500, 'kick'), note(0, 'snare'), note(250, 'hihat_closed')]
    const result = recommendSticking(notes, PPQ)
    expect(result.map((n) => n.piece)).toEqual(['kick', 'snare', 'hihat_closed'])
    expect(result.map((n) => n.hand)).toEqual(['RF', 'R', 'R']) // 틱순: hihat(250,same tick없음)->R, snare 단독->startHand(R)
  })
})

describe('alternateHandsByTick', () => {
  it('alternates selected notes starting at R, marking them all as user-set', () => {
    const notes = [note(0, 'snare'), note(120, 'snare'), note(240, 'snare'), note(360, 'snare')]
    const result = alternateHandsByTick(notes, 'R')
    expect(result.map((n) => n.hand)).toEqual(['R', 'L', 'R', 'L'])
    expect(result.every((n) => n.handSource === 'user')).toBe(true)
  })

  it('alternates starting at L when requested', () => {
    const notes = [note(0, 'snare'), note(120, 'snare')]
    const result = alternateHandsByTick(notes, 'L')
    expect(result.map((n) => n.hand)).toEqual(['L', 'R'])
  })

  it('orders by tick even when the input array is in a different order', () => {
    const notes = [note(360, 'tom_floor'), note(0, 'snare'), note(120, 'tom_high')]
    const result = alternateHandsByTick(notes, 'R')
    // 입력 순서(360,0,120) 그대로 반환되지만, 값은 틱순(0→R,120→L,360→R)으로 매겨짐
    expect(result.map((n) => n.hand)).toEqual(['R', 'R', 'L'])
  })

  it('overwrites an existing user-set hand — this action is itself a new user decision', () => {
    const notes = [note(0, 'snare', { hand: 'L', handSource: 'user' }), note(120, 'snare')]
    const result = alternateHandsByTick(notes, 'R')
    expect(result.map((n) => n.hand)).toEqual(['R', 'L'])
  })
})
