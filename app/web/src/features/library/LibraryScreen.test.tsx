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
})
