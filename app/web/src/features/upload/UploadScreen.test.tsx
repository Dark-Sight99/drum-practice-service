import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadScreen } from './UploadScreen'
import { ApiError } from '../../api/client'
import type { SongSummary } from '../../api/songs'

// T3-19 — 순수 DOM 이벤트(파일 입력·폼 제출)라 EditorScreen.test.tsx와 같은
// 이유로 jsdom에서 직접 테스트 가능. 실제 서버 호출(uploadSong/uploadAudioSong/
// fetchSong/fetchSongDrumScore)과 디지털 악보 파싱(importScoreFile)은 모킹.
//
// 모드A 재검토 지적(Low) — 처음엔 `vi.useFakeTimers({ shouldAdvanceTime: true })`로
// 실제 시간이 같이 흐르게 해뒀는데, 그러면 지연 타이머가 "아직 안 발동했다"는
// 전제가 테스트 실행 속도에 우연히 기대게 된다 — 전부 `vi.advanceTimersByTimeAsync()`로
// 가짜 시간만 명시적으로 전진시키는 방식으로 바꿔, 타이밍이 테스트 코드에만
// 좌우되게 한다.
//
// 2026-10-26 의뢰인 요청 — 음원 업로드는 더 이상 "업로드완료 ✓" 후 바로 모달이
// 닫히지 않는다. 분리·채보가 끝날 때까지 모달 안에서 진행 상태(스피너)를
// 보여주고(fetchSong 폴링, 2초 간격), 끝나면 "연주하기" 버튼으로 바로 연주
// 화면까지 이어준다 — 아래 테스트는 그 흐름에 맞춰 다시 썼다.

const { uploadSongMock, uploadAudioSongMock, fetchSongMock, fetchSongDrumScoreMock } = vi.hoisted(
  () => ({
    uploadSongMock: vi.fn(),
    uploadAudioSongMock: vi.fn(),
    fetchSongMock: vi.fn(),
    fetchSongDrumScoreMock: vi.fn(),
  }),
)
vi.mock('../../api/songs', () => ({
  uploadSong: uploadSongMock,
  uploadAudioSong: uploadAudioSongMock,
  fetchSong: fetchSongMock,
  fetchSongDrumScore: fetchSongDrumScoreMock,
}))

const { importScoreFileMock, validateDrumScoreMock } = vi.hoisted(() => ({
  importScoreFileMock: vi.fn(),
  validateDrumScoreMock: vi.fn(),
}))
vi.mock('../../score', () => ({
  importScoreFile: importScoreFileMock,
  validateDrumScore: validateDrumScoreMock,
}))

const uploadedSong: SongSummary = {
  id: 2,
  title: '곡',
  artist: null,
  status: 'pending',
  original_bpm: null,
  source_type: 'audio',
  available_audio_kinds: [],
}
const audioUploadResult: { song: SongSummary; job_id: number } = {
  song: uploadedSong,
  job_id: 10,
}

const noop = () => {}

function selectFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
}

/** File.arrayBuffer()(디지털 악보 파싱 경로가 씀)·모킹된 API 호출이 만드는
 * 마이크로태스크를 가짜 타이머 환경에서도 흘려보낸다(실제 시간 소모 없음). */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('UploadScreen (모달)', () => {
  beforeEach(() => {
    uploadSongMock.mockReset().mockResolvedValue({
      id: 1,
      title: '곡',
      artist: null,
      status: 'pending',
      original_bpm: null,
      source_type: 'midi',
      available_audio_kinds: [],
    })
    uploadAudioSongMock.mockReset().mockResolvedValue(audioUploadResult)
    fetchSongMock.mockReset().mockResolvedValue({ ...uploadedSong, status: 'processing' })
    fetchSongDrumScoreMock.mockReset()
    validateDrumScoreMock.mockReset().mockReturnValue({ valid: true, errors: [] })
    importScoreFileMock.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('음원 파일을 고르면 미리보기 없이 바로 제목/업로드 폼을 보여줌', async () => {
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={noop}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'my-song.mp3', { type: 'audio/mpeg' }))
    await flush()

    expect(screen.getByDisplayValue('my-song')).toBeInTheDocument() // 확장자 뺀 파일명이 제목 기본값
    expect(screen.getByRole('button', { name: '업로드' })).toBeInTheDocument()
    expect(importScoreFileMock).not.toHaveBeenCalled()
  })

  it('음원 업로드 제출 시 uploadAudioSong을 호출하고, 성공하면 onSongCreated를 부르고 생성 중 화면을 보여줌', async () => {
    const onSongCreated = vi.fn()
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={noop}
        onSongCreated={onSongCreated}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp4', { type: 'video/mp4' }))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    expect(uploadAudioSongMock).toHaveBeenCalledWith(expect.any(File), 'song', '')
    expect(onSongCreated).toHaveBeenCalledTimes(1) // 목록에 "처리 중" 카드가 바로 보이게

    expect(screen.getByRole('status')).toHaveTextContent('노트를 생성하는 중')
  })

  it('생성이 끝나면(폴링으로 completed 확인) 연주하기 버튼이 뜨고, 누르면 drumScore를 가져와 onPlaySong을 부른 뒤 모달을 닫음', async () => {
    const onPlaySong = vi.fn()
    const onCancel = vi.fn()
    const drumScore = {
      version: 1 as const,
      meta: { title: '곡', bpm: 120, timeSignature: [4, 4] as [number, number], source: 'audio' as const },
      ppq: 480,
      audioOffsetMs: 0,
      notes: [],
    }
    fetchSongDrumScoreMock.mockResolvedValue(drumScore)
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={onCancel}
        onSongCreated={noop}
        onPlaySong={onPlaySong}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent('노트를 생성하는 중')

    fetchSongMock.mockResolvedValueOnce({ ...uploadedSong, status: 'completed' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000) // 폴링 주기
    })
    expect(screen.getByRole('button', { name: '연주하기' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '연주하기' }))
    await flush()
    expect(fetchSongDrumScoreMock).toHaveBeenCalledWith(uploadedSong.id)
    expect(onPlaySong).toHaveBeenCalledWith(
      expect.objectContaining({ id: uploadedSong.id, status: 'completed' }),
      drumScore,
    )
    expect(onCancel).toHaveBeenCalledTimes(1) // 완료 토스트 없이 모달만 닫힘(바로 연주 화면으로 이동)
  })

  it('생성이 실패(failed)하면 실패 안내를 보여주고 연주하기는 안 뜸', async () => {
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={noop}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()

    fetchSongMock.mockResolvedValueOnce({ ...uploadedSong, status: 'failed' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.getByText(/노트 생성에 실패했습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '연주하기' })).not.toBeInTheDocument()
  })

  it('생성 중 모달을 닫으면 생성 중 화면이 사라지고, 그 뒤 뒤늦은 폴링 응답은 반영되지 않음', async () => {
    const onCancel = vi.fn()
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={onCancel}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    expect(screen.getByRole('status')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('presentation')) // 배경 클릭으로 닫기
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fetchSongMock.mockResolvedValueOnce({ ...uploadedSong, status: 'completed' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(screen.queryByRole('button', { name: '연주하기' })).not.toBeInTheDocument()
  })

  it('모드A 재검토 지적(Low, 반영) — 업로드 요청이 서버 응답 대기 중일 때 취소하면, 뒤늦게 응답이 와도 생성 중 화면으로 안 넘어감', async () => {
    let resolveUpload: ((value: typeof audioUploadResult) => void) | undefined
    uploadAudioSongMock.mockImplementation(
      () =>
        new Promise<typeof audioUploadResult>((resolve) => {
          resolveUpload = resolve
        }),
    )
    const onSongCreated = vi.fn()
    const onCancel = vi.fn()
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={onCancel}
        onSongCreated={onSongCreated}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    expect(uploadAudioSongMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '업로드 중…' })).toBeInTheDocument() // 응답 대기 중

    fireEvent.click(screen.getByRole('presentation')) // 배경 클릭으로 취소(요청은 여전히 떠 있음)
    expect(onCancel).toHaveBeenCalledTimes(1)

    // 그제서야 서버 응답이 늦게 도착
    await act(async () => {
      resolveUpload?.(audioUploadResult)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(onSongCreated).not.toHaveBeenCalled() // 이미 취소했으니 뒤늦은 성공 응답은 무시돼야 함
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('모드A 3차 재검토 지적(Low, 반영) — 취소 후 다시 제출했는데, 취소된 이전 요청이 뒤늦게 응답해도 생성 중 화면을 또 안 띄움', async () => {
    let resolveFirst: ((value: typeof audioUploadResult) => void) | undefined
    let resolveSecond: ((value: typeof audioUploadResult) => void) | undefined
    uploadAudioSongMock
      .mockImplementationOnce(
        () =>
          new Promise<typeof audioUploadResult>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<typeof audioUploadResult>((resolve) => {
            resolveSecond = resolve
          }),
      )
    const onSongCreated = vi.fn()
    const onCancel = vi.fn()
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={onCancel}
        onSongCreated={onSongCreated}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement

    // 1차 제출 — 응답 대기 중에 취소
    selectFile(input, new File(['x'], 'first.mp3', { type: 'audio/mpeg' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    fireEvent.click(screen.getByRole('presentation'))
    expect(onCancel).toHaveBeenCalledTimes(1)

    // 취소 후 같은 모달(마운트 상태 유지 — LibraryScreen이 open만 토글)에
    // 다시 파일을 골라 2차로 제출(아직 응답 안 함, 대기 중)
    selectFile(input, new File(['x'], 'second.mp3', { type: 'audio/mpeg' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    expect(uploadAudioSongMock).toHaveBeenCalledTimes(2)

    // 1차(이미 취소된) 요청이 이제서야 뒤늦게 응답 — 2차가 아직 안 끝났는데도
    // onSongCreated가 불리면 안 됨(세대 번호 불일치로 무시돼야 함).
    await act(async () => {
      resolveFirst?.({ ...audioUploadResult, song: { ...uploadedSong, id: 101 } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSongCreated).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '업로드 중…' })).toBeInTheDocument() // 2차는 여전히 대기 중

    // 2차 요청이 정상 응답하면 그때서야 생성 중 화면으로 전환
    await act(async () => {
      resolveSecond?.({ ...audioUploadResult, song: { ...uploadedSong, id: 202 } })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSongCreated).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('디지털 악보 파일을 고르면 클라이언트에서 바로 파싱해 미리보기를 보여줌', async () => {
    importScoreFileMock.mockReturnValue({
      ok: true,
      score: {
        version: 1,
        meta: { title: '테스트곡', bpm: 140, timeSignature: [4, 4], source: 'midi' },
        ppq: 480,
        audioOffsetMs: 0,
        notes: [{ tick: 0, piece: 'kick', velocity: 90, hand: null }],
      },
    })
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={noop}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mid', { type: 'audio/midi' }))
    await flush()

    expect(screen.getByText(/인식됨 — 노트 1개, BPM 140/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    expect(uploadSongMock).toHaveBeenCalledTimes(1)
    expect(uploadAudioSongMock).not.toHaveBeenCalled()
  })

  it('디지털 악보 업로드 제출 시 완료 표시 후 onUploaded를 부름(음원과 달리 생성 중 화면 없음)', async () => {
    importScoreFileMock.mockReturnValue({
      ok: true,
      score: {
        version: 1,
        meta: { title: '테스트곡', bpm: 140, timeSignature: [4, 4], source: 'midi' },
        ppq: 480,
        audioOffsetMs: 0,
        notes: [{ tick: 0, piece: 'kick', velocity: 90, hand: null }],
      },
    })
    const onUploaded = vi.fn()
    render(
      <UploadScreen
        open
        onUploaded={onUploaded}
        onCancel={noop}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mid', { type: 'audio/midi' }))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()
    // 마이크로 인터랙션 — 버튼이 "업로드완료 ✓"로 바뀜
    expect(screen.getByRole('button', { name: '업로드완료 ✓' })).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled() // 아직 지연 중(가짜 시간도 안 지남)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('지원하지 않는 확장자는 에러를 보여주고 업로드 폼을 안 띄움', async () => {
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={noop}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'photo.png', { type: 'image/png' }))
    await flush()

    expect(screen.getByText(/지원하지 않는 파일 형식입니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '업로드' })).not.toBeInTheDocument()
  })

  it('업로드 실패 시 에러 메시지를 보여주고 생성 중 화면으로 넘어가지 않음', async () => {
    uploadAudioSongMock.mockRejectedValue(new ApiError(500, '서버 오류'))
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={noop}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))
    await flush()

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await flush()

    expect(screen.getByText('서버 오류')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('배경을 클릭하면 onCancel이 불림(잘못 눌렀을 수도 있으니)', () => {
    const onCancel = vi.fn()
    render(
      <UploadScreen
        open
        onUploaded={noop}
        onCancel={onCancel}
        onSongCreated={noop}
        onPlaySong={noop}
      />,
    )
    fireEvent.click(screen.getByRole('presentation'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
