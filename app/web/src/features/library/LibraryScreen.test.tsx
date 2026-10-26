import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
