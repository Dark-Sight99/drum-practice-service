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
// 2026-10-27 — onSongCreated(silentReload 트리거)도 테스트에서 직접 눌러
// 유발할 수 있게 자리표시자에 버튼을 하나 더 둠(요청 경합 회귀 테스트용).
vi.mock('../upload/UploadScreen', () => ({
  UploadScreen: ({
    open,
    onUploaded,
    onSongCreated,
  }: {
    open: boolean
    onUploaded: () => void
    onSongCreated: () => void
  }) =>
    open ? (
      <>
        <button onClick={onUploaded}>mock-upload-complete</button>
        <button onClick={onSongCreated}>mock-song-created</button>
      </>
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
    await screen.findByText('테스트곡')

    // 제목 글자(버튼)가 아니라 카드의 "빈 부분"(메타 정보 줄)을 클릭.
    fireEvent.click(screen.getByText(/BPM 120/))
    await waitFor(() => expect(onOpenSong).toHaveBeenCalledTimes(1))
  })

  it('모드A 지적(필수, 반영) — 제목(버튼)을 클릭해도 한 번만 이동함(카드로 중복 전파 안 됨)', async () => {
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

    const titleButton = await screen.findByRole('button', { name: /테스트곡/ })
    fireEvent.click(titleButton)
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

describe('LibraryScreen — 목록 새로고침 경합(모드A 지적 반영)', () => {
  beforeEach(() => {
    listSongsMock.mockReset()
  })

  it('먼저 보낸 요청이 더 늦게 응답해도, 그 사이 들어온 최신 목록을 덮어쓰지 않고 로딩 스켈레톤도 안 남음', async () => {
    let resolveFirst: ((songs: SongSummary[]) => void) | undefined
    listSongsMock.mockImplementationOnce(
      () =>
        new Promise<SongSummary[]>((resolve) => {
          resolveFirst = resolve
        }),
    )
    const { container } = render(
      <LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />,
    )
    // 마운트 시 reload()가 1차 요청을 보냄 — 아직 응답 안 함(로딩 스켈레톤 상태).
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    // onSongCreated(silentReload)로 2차(최신) 요청을 보내고, 1차보다 먼저 응답하게 함.
    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    listSongsMock.mockResolvedValueOnce([makeSong({ status: 'completed' })])
    fireEvent.click(screen.getByRole('button', { name: 'mock-song-created' }))
    await waitFor(() => expect(screen.getByText('완료')).toBeInTheDocument())

    // 모드A 재검토 지적(필수, 반영) — 1차(reload)가 아직 응답 전인 상태에서
    // silentReload가 먼저 최신 데이터를 반영했으므로, 세대 불일치로 1차
    // 응답 처리가 통째로 무시돼도 로딩 스켈레톤은 걷혀 있어야 한다(전엔
    // setLoading(false)가 1차 응답 처리 쪽에만 있어서 영원히 안 걷혔음).
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)

    // 이제서야 1차(더 오래된) 요청이 "대기 중"으로 뒤늦게 응답 — 반영되면 안 됨.
    await act(async () => {
      resolveFirst?.([makeSong({ status: 'pending' })])
    })
    expect(screen.getByText('완료')).toBeInTheDocument() // 최신 상태 그대로 유지
    expect(screen.queryByText('대기 중')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
  })

  it('모드A 재검토 2차 지적(필수, 반영) — 최초 로딩이 아직 안 끝난 상태에서 silentReload가 실패해도 스켈레톤이 안 남고 에러로 전환됨', async () => {
    // 1차(reload)는 응답 안 함(마운트 시 보낸 채로 계속 대기) — 배경 폴링은
    // songs가 비어 있는 한 시작도 안 해서, onSongCreated만이 이 상황을
    // 재현할 수 있는 유일한 경로다.
    listSongsMock.mockImplementationOnce(() => new Promise<SongSummary[]>(() => {}))
    const { container } = render(
      <LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />,
    )
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    listSongsMock.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(screen.getByRole('button', { name: 'mock-song-created' }))

    await waitFor(() => expect(container.querySelectorAll('.skeleton')).toHaveLength(0))
    expect(screen.getByText('목록을 불러오지 못했습니다')).toBeInTheDocument()
  })

  // 모드A 재검토 지적(권장, 반영) — 이 테스트는 실제 2초 배경 폴링 타이머가
  // 아니라 onSongCreated 버튼으로 silentReload()를 직접 유발한다(배경 폴링도
  // 내부적으로 같은 silentReload()를 부르므로 실패 처리 로직 자체는 동일하게
  // 검증됨) — 제목을 그 경로에 맞게 명확히 함.
  it('silentReload(배경 폴링·onSongCreated 공용)가 이미 목록이 떠 있는 상태에서 실패하면 조용히 무시됨(에러 배너 안 뜸)', async () => {
    listSongsMock.mockResolvedValueOnce([makeSong({ status: 'pending' })])
    render(<LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />)
    await screen.findByText('테스트곡') // 최초 로딩 완료(loading===false)

    listSongsMock.mockRejectedValueOnce(new Error('transient'))
    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-song-created' })) // silentReload() 트리거

    await waitFor(() => expect(listSongsMock).toHaveBeenCalled())
    expect(screen.queryByText('목록을 불러오지 못했습니다')).not.toBeInTheDocument()
    expect(screen.getByText('테스트곡')).toBeInTheDocument() // 기존 목록 그대로 유지
  })

  it('모드A 5차 재검토 지적(필수, 반영) — 최초 로딩 실패 후 reload()로 재시도하면 옛 에러 문구 대신 스켈레톤이 다시 뜸', async () => {
    listSongsMock.mockRejectedValueOnce(new Error('최초 실패'))
    const { container } = render(
      <LibraryScreen onOpenSong={() => {}} onEditSong={() => {}} onLoggedOut={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('목록을 불러오지 못했습니다')).toBeInTheDocument(),
    )
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)

    // reload()를 다시 트리거 — 디지털 악보 업로드 완료 시 불리는 onUploaded 경로를
    // 재사용(= reload()를 부름). 응답을 바로 안 주고 대기시켜 "재시도 진행 중" 화면을
    // 관찰한다.
    let resolveRetry: ((songs: SongSummary[]) => void) | undefined
    listSongsMock.mockImplementationOnce(
      () =>
        new Promise<SongSummary[]>((resolve) => {
          resolveRetry = resolve
        }),
    )
    fireEvent.click(screen.getByRole('button', { name: '+ 업로드' }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-upload-complete' }))

    await waitFor(() =>
      expect(screen.queryByText('목록을 불러오지 못했습니다')).not.toBeInTheDocument(),
    )
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)

    await act(async () => {
      resolveRetry?.([makeSong({ status: 'completed' })])
    })
    expect(screen.getByText('완료')).toBeInTheDocument()
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
  })
})
