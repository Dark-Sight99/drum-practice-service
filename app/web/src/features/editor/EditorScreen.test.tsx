import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorScreen } from './EditorScreen'
import type { DrumScore } from '../../score/types'
import type { SongSummary } from '../../api/songs'

// Canvas·Tone.js가 아니라 순수 DOM 이벤트라 jsdom에서 실제로 테스트 가능
// (work/T2-6/plan.md §테스트계획 — T2-3·T2-4·T2-5와 다른 지점).

const song: SongSummary = {
  id: 7,
  title: '테스트곡',
  artist: null,
  status: 'completed',
  original_bpm: 120,
  source_type: 'midi',
  available_audio_kinds: [],
}

function makeScore(): DrumScore {
  return {
    version: 1,
    meta: { title: '테스트곡', bpm: 120, timeSignature: [4, 4], source: 'midi' },
    ppq: 480,
    audioOffsetMs: 0,
    notes: [{ tick: 480, piece: 'kick', velocity: 90, hand: null }],
  }
}

function makeTwoSnareScore(): DrumScore {
  return {
    version: 1,
    meta: { title: '테스트곡', bpm: 120, timeSignature: [4, 4], source: 'midi' },
    ppq: 480,
    audioOffsetMs: 0,
    notes: [
      { tick: 0, piece: 'snare', velocity: 90, hand: null },
      { tick: 120, piece: 'snare', velocity: 90, hand: null },
    ],
  }
}

describe('EditorScreen', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds a note when an empty grid cell is clicked', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    expect(snareRow.querySelectorAll('button')).toHaveLength(0)

    fireEvent.click(snareRow, { clientX: 100 })

    expect(snareRow.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByText(/선택됨: SN/)).toBeInTheDocument()
  })

  it('selects an existing note when clicked, without adding a duplicate', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    const noteButtons = kickRow.querySelectorAll('button')
    expect(noteButtons).toHaveLength(1)

    fireEvent.click(noteButtons[0])

    expect(kickRow.querySelectorAll('button')).toHaveLength(1) // still just the one note
    expect(screen.getByText(/선택됨: KK/)).toBeInTheDocument()
  })

  it('deletes the selected note with the Delete key', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    expect(screen.getByText(/선택됨: KK/)).toBeInTheDocument()

    const grid = screen.getByRole('application')
    fireEvent.keyDown(grid, { key: 'Delete' })

    expect(screen.queryByText(/선택됨:/)).not.toBeInTheDocument()
    expect(kickRow.querySelectorAll('button')).toHaveLength(0)
  })

  it('moves the selected note in time with ArrowRight (grid-snapped)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    expect(screen.getByText(/틱 480/)).toBeInTheDocument()

    const grid = screen.getByRole('application')
    fireEvent.keyDown(grid, { key: 'ArrowRight' }) // 기본 격자 8분(240틱) 이동

    expect(screen.getByText(/틱 720/)).toBeInTheDocument()
  })

  it('keeps moved notes on an integer tick even when ppq is not divisible by the grid divisor (Codex 모드A 지적)', () => {
    const score: DrumScore = {
      version: 1,
      meta: { title: '테스트곡', bpm: 120, timeSignature: [4, 4], source: 'midi' },
      ppq: 100, // 100 / 3(8nt 분할) = 33.333… — 정수가 아닌 격자 스텝
      audioOffsetMs: 0,
      notes: [{ tick: 50, piece: 'kick', velocity: 90, hand: null }],
    }
    render(<EditorScreen song={song} initialScore={score} onSaved={() => {}} onCancel={() => {}} />)

    const select = screen.getByDisplayValue('8분') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '8nt' } })

    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    const grid = screen.getByRole('application')
    fireEvent.keyDown(grid, { key: 'ArrowRight' })

    const text = screen.getByText(/틱 [\d.]+/).textContent ?? ''
    const tick = Number(/틱 ([\d.]+)/.exec(text)?.[1])
    expect(Number.isInteger(tick)).toBe(true)
  })

  it('changes the selected note piece with ArrowUp/ArrowDown', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    expect(screen.getByText(/선택됨: KK/)).toBeInTheDocument()

    const grid = screen.getByRole('application')
    fireEvent.keyDown(grid, { key: 'ArrowUp' }) // KK는 마지막 행 — 한 칸 위는 RD

    expect(screen.getByText(/선택됨: RD/)).toBeInTheDocument()
  })

  it('supports undo/redo via the toolbar buttons', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    fireEvent.click(snareRow, { clientX: 100 })
    expect(snareRow.querySelectorAll('button')).toHaveLength(1)

    fireEvent.click(screen.getByText('실행취소'))
    expect(snareRow.querySelectorAll('button')).toHaveLength(0)

    fireEvent.click(screen.getByText('다시실행'))
    expect(snareRow.querySelectorAll('button')).toHaveLength(1)
  })

  it('does not let grid shortcuts interfere with the BPM input', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    expect(screen.getByText(/틱 480/)).toBeInTheDocument()

    const bpmInput = screen.getByDisplayValue('120') as HTMLInputElement
    fireEvent.keyDown(bpmInput, { key: 'ArrowRight' }) // BPM 입력창 안에서 누른 방향키

    // 그리드 핸들러는 그리드 컨테이너에만 달려 있어 입력창 키 입력이 거기로
    // 버블링되지 않는다 — 선택된 노트의 틱이 그대로여야 한다.
    expect(screen.getByText(/틱 480/)).toBeInTheDocument()
  })

  it('calls saveSongDrumScore with the edited score on save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()

    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={onSaved} onCancel={() => {}} />,
    )
    fireEvent.click(screen.getByText('저장'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/7/drumscore',
      expect.objectContaining({ method: 'PUT' }),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const sentScore = JSON.parse(init.body as string) as DrumScore
    expect(sentScore.notes).toHaveLength(1)
    expect(sentScore.notes[0].piece).toBe('kick')
  })

  it('shows an error message and does not call onSaved when the save request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: '서버 오류' }), {
        status: 500,
      })),
    )
    const onSaved = vi.fn()

    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={onSaved} onCancel={() => {}} />,
    )
    fireEvent.click(screen.getByText('저장'))

    await waitFor(() => expect(screen.getByText('서버 오류')).toBeInTheDocument())
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('assigns a hand to the selected note via the R/L/RF/LF buttons (REQ-12)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    expect(screen.getByText(/손: 미지정/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('RF'))

    expect(screen.getByText(/손: 오른발\(지정\)/)).toBeInTheDocument()
  })

  it('clears the hand with the 손 지우기 button', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    fireEvent.click(screen.getByText('RF'))
    expect(screen.getByText(/손: 오른발/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('손 지우기'))

    expect(screen.getByText(/손: 미지정/)).toBeInTheDocument()
  })

  it('does not show the multi-select batch bar for a plain (non-modifier) click — selection replaces, not toggles', () => {
    render(
      <EditorScreen
        song={song}
        initialScore={makeTwoSnareScore()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    const notes = snareRow.querySelectorAll('button')
    fireEvent.click(notes[0])
    fireEvent.click(notes[1])

    expect(screen.queryByText(/선택: \d+개 노트/)).not.toBeInTheDocument()
    expect(screen.getByText(/선택됨: SN/)).toBeInTheDocument()
  })

  it('Ctrl+click adds a note to a multi-selection, showing the batch bar', () => {
    render(
      <EditorScreen
        song={song}
        initialScore={makeTwoSnareScore()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    const notes = snareRow.querySelectorAll('button')
    fireEvent.click(notes[0])
    fireEvent.click(notes[1], { ctrlKey: true })

    expect(screen.getByText('선택: 2개 노트')).toBeInTheDocument()
  })

  it('applies RLRL alternation by tick order to a multi-selection, marking them user-set', () => {
    render(
      <EditorScreen
        song={song}
        initialScore={makeTwoSnareScore()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    const notes = snareRow.querySelectorAll('button')
    fireEvent.click(notes[0])
    fireEvent.click(notes[1], { ctrlKey: true })
    expect(screen.getByText('선택: 2개 노트')).toBeInTheDocument()

    fireEvent.click(screen.getByText('RLRL 교대'))

    // 다중선택 바가 사라지고(선택은 그대로 유지되지만 단일선택 바로는 안 뜸 —
    // 다중선택 시 selectedNote는 null이라 손 상태는 각 노트를 다시 눌러 확인한다)
    fireEvent.click(notes[0])
    expect(screen.getByText(/손: 오른손\(지정\)/)).toBeInTheDocument()
    fireEvent.click(notes[1])
    expect(screen.getByText(/손: 왼손\(지정\)/)).toBeInTheDocument()
  })

  it('applies auto-recommended sticking without overwriting a user-set hand', () => {
    render(
      <EditorScreen
        song={song}
        initialScore={makeTwoSnareScore()}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    const notes = snareRow.querySelectorAll('button')
    // 첫 노트를 사용자가 직접 L로 지정.
    fireEvent.click(notes[0])
    fireEvent.click(screen.getByText('L'))
    expect(screen.getByText(/손: 왼손\(지정\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('자동 추천 재적용'))

    fireEvent.click(notes[0])
    expect(screen.getByText(/손: 왼손\(지정\)/)).toBeInTheDocument() // user 값 유지
    fireEvent.click(notes[1])
    expect(screen.getByText(/손: .+\(추천\)/)).toBeInTheDocument() // 자동 추천으로 채워짐
  })
})
