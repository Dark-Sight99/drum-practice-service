import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryScreen } from './LibraryScreen'
import type { SongSummary } from '../../api/songs'

// T3-19 모드A 지적 후 추가 발견(2026-10-26, 의뢰인 실사용 중 재발견) — 음원
// 업로드로 "처리 중"인 곡이 흔해졌는데, 처리가 안 끝난 곡을 열면 아직 없는
// DrumScore를 조회하다 에러가 그대로 사용자에게 보이던 버그의 회귀 테스트.
// 순수 DOM 이벤트라 EditorScreen.test.tsx와 같은 이유로 jsdom에서 직접 테스트
// 가능.

const { listSongsMock, fetchSongDrumScoreMock, deleteSongMock, renameSongMock } = vi.hoisted(
  () => ({
    listSongsMock: vi.fn(),
    fetchSongDrumScoreMock: vi.fn(),
    deleteSongMock: vi.fn(),
    renameSongMock: vi.fn(),
  }),
)
vi.mock('../../api/songs', () => ({
  listSongs: listSongsMock,
  fetchSongDrumScore: fetchSongDrumScoreMock,
  deleteSong: deleteSongMock,
  renameSong: renameSongMock,
}))

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }))
vi.mock('../../api/auth', () => ({ logout: logoutMock }))

// 2026-10-26 의뢰인 요청 — 업로드 완료 토스트 테스트용. 실제 업로드 흐름은
// UploadScreen.test.tsx에서 이미 검증하므로, 여기선 LibraryScreen이
// onUploaded를 받았을 때 토스트를 띄우는지만 확인 — UploadScreen을 "완료
// 버튼"만 있는 자리표시자로 대체.
vi.mock('../upload/UploadScreen', () => ({
  UploadScreen: ({ open, onUploaded }: { open: boolean; onUploaded: () => void }) =>
    open ? (
      <button onClick={onUploaded}>mock-upload-complete</button>
    ) : null,
}))

function makeSong(overrides: Partial<SongSummary> = {}): SongSummary {
  return {
    id: 1,
    title: '테스트곡',
    artist: null,
    status: 'completed',
    original_bpm: 120,
    source_type: 'audio',
    available_audio_kinds: ['stem_drums'],
    ...overrides,
  }
}

describe('LibraryScreen — 처리 안 끝난 곡 보호', () => {
  beforeEach(() => {
    listSongsMock.mockReset()
    fetchSongDrumScoreMock.mockReset()
    deleteSongMock.mockReset()
    renameSongMock.mockReset()
    logoutMock.mockReset()
  })

  it('처리 중(completed 아님)인 곡은 제목이 버튼이 아니고, 편집 버튼도 비활성화됨', async () => {
    listSongsMock.mockResolvedValue([makeSong({ status: 'pending' })])
    render(<LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />)

    await screen.findByText('테스트곡')
    expect(screen.queryByRole('button', { name: /테스트곡/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '편집' })).toBeDisabled()
    expect(screen.getByText('대기 중')).toBeInTheDocument() // 상태가 한글로 보임
    expect(fetchSongDrumScoreMock).not.toHaveBeenCalled()
  })

  it('processing/failed 상태도 마찬가지로 막힘', async () => {
    listSongsMock.mockResolvedValue([
      makeSong({ id: 1, title: '처리중곡', status: 'processing' }),
      makeSong({ id: 2, title: '실패곡', status: 'failed' }),
    ])
    render(<LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />)

    await screen.findByText('처리중곡')
    expect(screen.getByText('처리 중…')).toBeInTheDocument()
    expect(screen.getByText('실패')).toBeInTheDocument()
    const editButtons = screen.getAllByRole('button', { name: '편집' })
    expect(editButtons).toHaveLength(2)
    for (const button of editButtons) expect(button).toBeDisabled()
  })

  it('completed 곡은 평소대로 열기/편집 가능', async () => {
    const onOpenSong = vi.fn()
    const song = makeSong({ status: 'completed' })
    listSongsMock.mockResolvedValue([song])
    fetchSongDrumScoreMock.mockResolvedValue({
      version: 1,
      meta: { title: '테스트곡', bpm: 120, timeSignature: [4, 4], source: 'audio' },
      ppq: 480,
      audioOffsetMs: 0,
      notes: [],
    })
    render(
      <LibraryScreen onOpenSong={onOpenSong} onEditSong={() => {}} onLoggedOut={() => {}} />,
    )

    const titleButton = await screen.findByRole('button', { name: /테스트곡/ })
    expect(screen.getByRole('button', { name: '편집' })).not.toBeDisabled()

    fireEvent.click(titleButton)
    await waitFor(() => expect(onOpenSong).toHaveBeenCalledTimes(1))
    expect(fetchSongDrumScoreMock).toHaveBeenCalledWith(song.id)
  })
})

describe('LibraryScreen — 업로드 완료 토스트(2026-10-26 의뢰인 요청)', () => {
  beforeEach(() => {
    listSongsMock.mockReset().mockResolvedValue([])
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('업로드가 완료되면 체크 문구 토스트가 뜨고, 일정 시간 후 사라짐', async () => {
    render(<LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // 마운트 시 reload() 플러시
    })

    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'mock-upload-complete' }))
    expect(screen.getByRole('status')).toHaveTextContent('업로드가 완료되었습니다')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000) // Toast 기본 지속 시간
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('모드A 재검토 지적(반영) — 토스트가 떠 있는 중 또 업로드를 완료하면 타이머가 새로 시작됨', async () => {
    render(<LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-upload-complete' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000) // 첫 토스트가 뜬 지 2초 — 아직 안 사라짐
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    // 같은 문구라 메시지 텍스트만으론 React가 새 토스트인지 구분 못 함(key로 구분) — 이
    // 시점(첫 타이머 기준 2초)에 두 번째 업로드가 완료되면 타이머가 새로 시작돼야 함.
    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-upload-complete' }))
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      // 누적 4초 — 고쳐지기 전이면 첫 타이머(3초)가 1초 전에 이미 끝나 토스트가
      // 사라졌어야 함. 두 번째 완료로부터는 아직 2초(3초 안 지남).
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000) // 두 번째 완료로부터 3초
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('LibraryScreen — 로딩 스켈레톤(2026-10-26 의뢰인 요청)', () => {
  it('목록을 불러오는 동안 스켈레톤이 뜨고, 응답이 오면 사라짐', async () => {
    let resolveList: ((songs: SongSummary[]) => void) | undefined
    listSongsMock.mockReset().mockImplementation(
      () =>
        new Promise<SongSummary[]>((resolve) => {
          resolveList = resolve
        }),
    )
    const { container } = render(
      <LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />,
    )

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByText('아직 업로드한 곡이 없습니다.')).not.toBeInTheDocument()

    await act(async () => {
      resolveList?.([])
    })
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
    expect(screen.getByText('아직 업로드한 곡이 없습니다.')).toBeInTheDocument()
  })
})

describe('LibraryScreen — 카드 전체 클릭(2026-10-26 의뢰인 요청)', () => {
  beforeEach(() => {
    listSongsMock.mockReset()
    fetchSongDrumScoreMock.mockReset()
  })

  it('카드의 빈 영역을 클릭하면 연주 화면으로 이동함(처리 완료된 곡)', async () => {
    const onOpenSong = vi.fn()
    const song = makeSong({ status: 'completed' })
    listSongsMock.mockResolvedValue([song])
    fetchSongDrumScoreMock.mockResolvedValue({
      version: 1,
      meta: { title: '테스트곡', bpm: 120, timeSignature: [4, 4], source: 'audio' },
      ppq: 480,
      audioOffsetMs: 0,
      notes: [],
    })
    render(<LibraryScreen onOpenSong={onOpenSong} onEditSong={() => {}} onLoggedOut={() => {}} />)

    const card = (await screen.findByText('테스트곡')).closest('[role="button"]')
    expect(card).not.toBeNull()
    // 제목 글자가 아니라 카드의 "빈 부분"(메타 정보 줄)을 클릭.
    fireEvent.click(screen.getByText(/BPM 120/))
    await waitFor(() => expect(onOpenSong).toHaveBeenCalledTimes(1))
  })

  it('편집·이름변경·삭제 버튼을 눌러도 연주 화면으로는 안 넘어감', async () => {
    const onOpenSong = vi.fn()
    const onEditSong = vi.fn()
    const song = makeSong({ status: 'completed' })
    listSongsMock.mockResolvedValue([song])
    fetchSongDrumScoreMock.mockResolvedValue({
      version: 1,
      meta: { title: '테스트곡', bpm: 120, timeSignature: [4, 4], source: 'audio' },
      ppq: 480,
      audioOffsetMs: 0,
      notes: [],
    })
    render(
      <LibraryScreen onOpenSong={onOpenSong} onEditSong={onEditSong} onLoggedOut={() => {}} />,
    )
    await screen.findByText('테스트곡')

    fireEvent.click(screen.getByRole('button', { name: '편집' }))
    await waitFor(() => expect(onEditSong).toHaveBeenCalledTimes(1))
    expect(onOpenSong).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '이름변경' }))
    expect(screen.getByDisplayValue('테스트곡')).toBeInTheDocument() // 이름변경 입력창으로 바뀜
    expect(onOpenSong).not.toHaveBeenCalled()

    // 이름변경 입력창 자체를 클릭해도 카드로 전파돼 이동하면 안 됨.
    fireEvent.click(screen.getByDisplayValue('테스트곡'))
    expect(onOpenSong).not.toHaveBeenCalled()
  })

  it('처리 중(완료 아님)인 카드는 클릭해도 이동하지 않음', async () => {
    const onOpenSong = vi.fn()
    listSongsMock.mockResolvedValue([makeSong({ status: 'pending' })])
    render(<LibraryScreen onOpenSong={onOpenSong} onEditSong={() => {}} onLoggedOut={() => {}} />)

    await screen.findByText('테스트곡')
    fireEvent.click(screen.getByText(/BPM 120/))
    expect(onOpenSong).not.toHaveBeenCalled()
  })
})
