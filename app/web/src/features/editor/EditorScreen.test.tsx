import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorScreen } from './EditorScreen'
import type { DrumScore } from '../../score/types'
import type { SongSummary } from '../../api/songs'
import { defaultMixerState } from '../../audio'

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
    // T3-60(연주 화면 레인 순서와 통일) — KK 한 칸 위는 이제 SN.
    fireEvent.keyDown(grid, { key: 'ArrowUp' })

    expect(screen.getByText(/선택됨: SN/)).toBeInTheDocument()
  })

  it('supports undo/redo via the toolbar buttons', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    fireEvent.click(snareRow, { clientX: 100 })
    expect(snareRow.querySelectorAll('button')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '실행취소' }))
    expect(snareRow.querySelectorAll('button')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '다시실행' }))
    expect(snareRow.querySelectorAll('button')).toHaveLength(1)
  })

  it('shows a play button and time display, but does not auto-play (2026-10-29 의뢰인 요청)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()
    expect(screen.getByText('0:00')).toBeInTheDocument()
  })

  it('shows the synth-only fallback message when the song has no separated audio (2026-10-29 의뢰인 요청 — "원곡을 듣고 고쳐야지")', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    expect(
      screen.getByText('이 곡은 음원 분리가 안 돼 있어 신스 드럼만 재생됩니다.'),
    ).toBeInTheDocument()
    // 음원이 없으므로 원곡 채널 슬라이더는 안 뜸.
    expect(screen.queryByText('베이스')).not.toBeInTheDocument()
  })

  it('never silences synth_drums for a song with no stems at all, even if the shared account mixer favors synth over a silent original drum (2026-10-29 의뢰인 요청 — 드럼원곡 음량 가져오기, 회귀 방지)', async () => {
    const volumes = defaultMixerState()
    volumes.stem_drums.volume = 0
    volumes.synth_drums.volume = 0.8
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        typeof url === 'string' && url.includes('mixer-setting')
          ? Promise.resolve(new Response(JSON.stringify({ volumes }), { status: 200 }))
          : Promise.resolve(new Response(null, { status: 204 })),
      ),
    )
    // 이 곡은 음원 분리가 전혀 안 돼 있다 — "드럼원곡으로 대체할 트랙"
    // 자체가 없으므로, 계정 설정이 "원곡 드럼=0, 신스 드럼=80%"이어도
    // 신스 드럼을 무음 처리하면(대체할 소리가 없으니) 편집 중 드럼이
    // 전혀 안 들리는 회귀가 된다 — 절대 건드리지 않아야 함.
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    await waitFor(() => {
      const slider = screen
        .getAllByDisplayValue('80')
        .find((el) => (el as HTMLInputElement).type === 'range')
      expect(slider).toBeInTheDocument()
    })
  })

  it('does not attempt to load audio tracks when audioOffsetMs is non-zero, even if stems exist', () => {
    const songWithStems: SongSummary = { ...song, available_audio_kinds: ['stem_drums', 'stem_bass'] }
    const scoreWithOffset: DrumScore = { ...makeScore(), audioOffsetMs: 50 }
    render(
      <EditorScreen
        song={songWithStems}
        initialScore={scoreWithOffset}
        onSaved={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(
      screen.getByText('이 곡은 음원 분리가 안 돼 있어 신스 드럼만 재생됩니다.'),
    ).toBeInTheDocument()
  })

  it('scrolls the grid to initialPositionTicks on mount without starting playback (연주 화면 "편집하기" 연동)', () => {
    render(
      <EditorScreen
        song={song}
        initialScore={makeScore()}
        onSaved={() => {}}
        onCancel={() => {}}
        initialPositionTicks={960}
      />,
    )
    // 재생은 자동으로 시작되지 않는다(의뢰인 명시) — 버튼은 여전히 "재생".
    expect(screen.getByRole('button', { name: '재생' })).toBeInTheDocument()
    const grid = screen.getByRole('application')
    expect(grid.scrollLeft).toBeGreaterThan(0)
  })

  it('seeks forward/backward even while not playing, clamped at 0 (2026-10-29 의뢰인 요청 — "앞으로 뒤로 이동이 안되서")', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByText('0:00')).toBeInTheDocument()

    // makeScore()는 노트가 1개뿐(틱 480)이라 곡 길이(여유 2마디 포함) 추정이
    // 짧다 — +10초는 곡 끝(위 클램프 상한)을 넘어서므로, 상한 안쪽 값으로
    // "이동 자체가 되는지"만 확인한다(상한 클램프 자체는 PracticeCanvas.tsx의
    // handleSeek()와 같은 원리라 이 화면에서 별도로 재검증하지 않음).
    fireEvent.click(screen.getByRole('button', { name: '10초 앞으로' }))
    expect(screen.getByText(/^0:0[1-9]|^0:[1-5]\d/)).toBeInTheDocument()
    expect(screen.queryByText('0:00')).not.toBeInTheDocument()

    // 0초 아래로는 못 내려감(클램프).
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }))
    fireEvent.click(screen.getByRole('button', { name: '10초 뒤로' }))
    expect(screen.getByText('0:00')).toBeInTheDocument()
  })

  it('shows and wires up the "연습 화면으로" back button only when onBackToPractice is given (2026-10-29 의뢰인 요청)', () => {
    const onBackToPractice = vi.fn()
    render(
      <EditorScreen
        song={song}
        initialScore={makeScore()}
        onSaved={() => {}}
        onCancel={() => {}}
        initialPositionTicks={960}
        onBackToPractice={onBackToPractice}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '← 연습 화면' }))
    expect(onBackToPractice).toHaveBeenCalledWith(960)
  })

  it('does not show the "연습 화면으로" back button when onBackToPractice is not given (라이브러리에서 바로 편집으로 들어온 경우)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: '← 연습 화면' })).not.toBeInTheDocument()
  })

  it('does not let grid shortcuts interfere with the playback-speed input (2026-10-29부터 BPM 자체는 편집 불가, 재생 속도만 조절)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    fireEvent.click(kickRow.querySelectorAll('button')[0])
    expect(screen.getByText(/틱 480/)).toBeInTheDocument()

    // 재생 속도 입력의 초깃값은 원곡 BPM(120)과 같다(아직 조절 전이므로) —
    // 슬라이더(type=range)도 같은 값이라 getAllByDisplayValue로 찾아 숫자
    // 입력창(type=number)만 골라낸다.
    const speedInput = screen
      .getAllByDisplayValue('120')
      .find((el) => (el as HTMLInputElement).type === 'number') as HTMLInputElement
    fireEvent.keyDown(speedInput, { key: 'ArrowRight' }) // 입력창 안에서 누른 방향키

    // 그리드 핸들러는 그리드 컨테이너에만 달려 있어 입력창 키 입력이 거기로
    // 버블링되지 않는다 — 선택된 노트의 틱이 그대로여야 한다.
    expect(screen.getByText(/틱 480/)).toBeInTheDocument()
  })

  it('disables the save button until something actually changes (2026-10-29 의뢰인 요청)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()

    const snareRow = screen.getByTestId('editor-row-snare')
    fireEvent.click(snareRow, { clientX: 100 })
    expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled()

    // undo로 변경 전(저장된 시점)까지 되돌아오면 다시 비활성화 — 값 비교가
    // 아니라 "저장 시점의 바로 그 상태 객체로 돌아왔는지" 참조 비교라서
    // undo가 저장 시점 상태를 정확히 복원함을 같이 확인.
    fireEvent.click(screen.getByRole('button', { name: '실행취소' }))
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('calls saveSongDrumScore with the edited score on save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()

    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={onSaved} onCancel={() => {}} />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    fireEvent.click(snareRow, { clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/songs/7/drumscore',
      expect.objectContaining({ method: 'PUT' }),
    )
    // 이 화면이 마운트 중 계정 믹서 설정도 불러오므로(같은 fetchMock을 공유),
    // "첫 번째 호출"이 아니라 drumscore PUT 호출을 정확히 찾아낸다.
    const drumscoreCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    ) as [string, RequestInit]
    const sentScore = JSON.parse(drumscoreCall[1].body as string) as DrumScore
    expect(sentScore.notes).toHaveLength(2)
    expect(sentScore.notes.map((n) => n.piece).sort()).toEqual(['kick', 'snare'])
  })

  it('adjusting playback speed never touches meta.bpm on save, and alone does not enable 저장 (2026-10-29 의뢰인 요청)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()

    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={onSaved} onCancel={() => {}} />,
    )

    // 재생 속도만 바꾸면(실제 편집 없이) 저장 버튼은 계속 비활성 — playbackBpm은
    // commit()/history를 거치지 않는 별도 state이기 때문. 숫자 입력창만 골라낸다
    // (슬라이더도 같은 값이라 getByDisplayValue 단독으론 중복 매치됨).
    const speedInput = screen
      .getAllByDisplayValue('120')
      .find((el) => (el as HTMLInputElement).type === 'number') as HTMLInputElement
    fireEvent.focus(speedInput)
    fireEvent.change(speedInput, { target: { value: '150' } })
    fireEvent.blur(speedInput)
    expect(
      screen.getAllByDisplayValue('150').find((el) => (el as HTMLInputElement).type === 'number'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()

    // 실제 노트 편집과 함께 저장해도, 서버로 보내는 meta.bpm은 원곡 그대로.
    const snareRow = screen.getByTestId('editor-row-snare')
    fireEvent.click(snareRow, { clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const drumscoreCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    ) as [string, RequestInit]
    const sentScore = JSON.parse(drumscoreCall[1].body as string) as DrumScore
    expect(sentScore.meta.bpm).toBe(120)
  })

  it('shows an error message and does not call onSaved when the save request fails', async () => {
    // 이 화면이 마운트 중 계정 믹서 설정도 불러오므로(같은 fetch mock을
    // 공유), mockResolvedValue로 Response 인스턴스 하나를 고정해 재사용하면
    // 두 호출 중 먼저 .json()을 읽은 쪽이 바디 스트림을 다 써버려 나머지
    // 호출은 상태 텍스트로 대체된다(T3-55 qa-evidence의 같은 패턴) — 매
    // 호출마다 새 Response를 만들어야 한다.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify({ detail: '서버 오류' }), { status: 500 }),
          ),
        ),
    )
    const onSaved = vi.fn()

    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={onSaved} onCancel={() => {}} />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    fireEvent.click(snareRow, { clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

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

  it('creates a closed hihat note by default on the merged HH row, toggleable to open (2026-10-29 의뢰인 요청 — HH 통합)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const hhRow = screen.getByTestId('editor-row-hihat_closed')
    fireEvent.click(hhRow, { clientX: 100 })
    expect(screen.getByText(/선택됨: HH/)).toBeInTheDocument()
    expect(hhRow.querySelectorAll('button')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '열림' }))

    // 피스가 바뀌어도 여전히 같은 HH 행(닫힘/열림 공유)에 그대로 있다 —
    // 새 노트가 추가되거나 다른 행으로 옮겨가지 않았는지 확인.
    expect(hhRow.querySelectorAll('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '열림' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '닫힘' })).not.toBeDisabled()
  })

  it('does not reset a HH note back to closed when only nudging it sideways with ArrowRight', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const hhRow = screen.getByTestId('editor-row-hihat_closed')
    fireEvent.click(hhRow, { clientX: 100 })
    fireEvent.click(screen.getByRole('button', { name: '열림' }))
    expect(screen.getByRole('button', { name: '열림' })).toBeDisabled()

    const grid = screen.getByRole('application')
    fireEvent.keyDown(grid, { key: 'ArrowRight' })

    // 가로 이동만 했을 뿐인데 행 경계 로직이 "기본 피스(닫힘)"로 되돌리면
    // 안 된다 — moveSelected()가 같은 행에 머무를 때는 피스를 보존해야 함.
    expect(screen.getByRole('button', { name: '열림' })).toBeDisabled()
  })

  it('drags a note to a new tick position with the mouse (2026-10-29 의뢰인 요청 — 드래그로 옮기기)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    const noteButton = kickRow.querySelectorAll('button')[0]
    fireEvent.click(noteButton)
    expect(screen.getByText(/틱 480/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()

    fireEvent.mouseDown(noteButton, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 124 }) // 격자 한 칸(24px) 오른쪽 — 8분(240틱)
    fireEvent.mouseUp(window, { clientX: 124 })

    expect(screen.getByText(/틱 720/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).not.toBeDisabled()
  })

  it('does not create a spurious extra note when a drag release is followed by a click on the row (Codex 모드A 지적 — mousedown·mouseup 타깃이 다르면 click은 그 공통 조상인 행에서 발생)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    const noteButton = kickRow.querySelectorAll('button')[0]

    fireEvent.mouseDown(noteButton, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 124 })
    fireEvent.mouseUp(window, { clientX: 124 })
    // 실제 브라우저에서는 mousedown(노트)·mouseup(행 배경)의 공통 조상인
    // 행에서 click이 합성돼 handleRowClick이 불릴 수 있다 — jsdom은 이걸
    // 자동으로 안 해주므로 직접 흉내낸다.
    fireEvent.click(kickRow, { clientX: 124 })

    expect(kickRow.querySelectorAll('button')).toHaveLength(1) // 새 노트가 안 생겨야 함
  })

  it('does not commit a drag that snaps back to the original tick (no-op move)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    const noteButton = kickRow.querySelectorAll('button')[0]
    fireEvent.click(noteButton)

    fireEvent.mouseDown(noteButton, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 105 }) // 격자 한 칸(24px)에 한참 못 미침 — 스냅되면 원위치
    fireEvent.mouseUp(window, { clientX: 105 })

    expect(screen.getByText(/틱 480/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('snaps a click to the cell it falls inside (floor), not the nearest grid line (2026-10-29 의뢰인 재지적 — 반올림이면 여기선 틱 240으로 갔을 것)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const snareRow = screen.getByTestId('editor-row-snare')
    // ROW_LABEL_WIDTH(64) + 20px — 0~240틱 칸의 오른쪽(20/24)에 치우친
    // 지점. "가장 가까운 선"(반올림)이었다면 240으로 갔을 자리.
    fireEvent.click(snareRow, { clientX: 84 })

    expect(screen.getByText(/틱 0\b/)).toBeInTheDocument()
  })

  it('keeps a dragged note in its current cell until the drag fully crosses into the next one (바닥 함수 확인)', () => {
    render(
      <EditorScreen song={song} initialScore={makeScore()} onSaved={() => {}} onCancel={() => {}} />,
    )
    const kickRow = screen.getByTestId('editor-row-kick')
    const noteButton = kickRow.querySelectorAll('button')[0]
    fireEvent.click(noteButton)

    // +20px — 다음 격자선(+24px)에는 못 미치지만, "가장 가까운 선"
    // (반올림, 절반인 12px 기준)이었다면 이미 다음 칸(틱 720)으로
    // 넘어갔을 거리.
    fireEvent.mouseDown(noteButton, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 120 })
    fireEvent.mouseUp(window, { clientX: 120 })

    expect(screen.getByText(/틱 480/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })
})
