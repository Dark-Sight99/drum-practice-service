import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadScreen } from './UploadScreen'
import { ApiError } from '../../api/client'

// T3-19 — 순수 DOM 이벤트(파일 입력·폼 제출)라 EditorScreen.test.tsx와 같은
// 이유로 jsdom에서 직접 테스트 가능. 실제 서버 호출(uploadSong/uploadAudioSong)과
// 디지털 악보 파싱(importScoreFile)은 모킹 — 각각의 실제 동작은 다른 테스트
// (score/import, api 쪽)에서 이미 검증됨.

const { uploadSongMock, uploadAudioSongMock } = vi.hoisted(() => ({
  uploadSongMock: vi.fn(),
  uploadAudioSongMock: vi.fn(),
}))
vi.mock('../../api/songs', () => ({
  uploadSong: uploadSongMock,
  uploadAudioSong: uploadAudioSongMock,
}))

const { importScoreFileMock, validateDrumScoreMock } = vi.hoisted(() => ({
  importScoreFileMock: vi.fn(),
  validateDrumScoreMock: vi.fn(),
}))
vi.mock('../../score', () => ({
  importScoreFile: importScoreFileMock,
  validateDrumScore: validateDrumScoreMock,
}))

function selectFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
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
    uploadAudioSongMock.mockReset().mockResolvedValue({
      song: {
        id: 2,
        title: '곡',
        artist: null,
        status: 'pending',
        original_bpm: null,
        source_type: 'audio',
        available_audio_kinds: [],
      },
      job_id: 10,
    })
    validateDrumScoreMock.mockReset().mockReturnValue({ valid: true, errors: [] })
    importScoreFileMock.mockReset()
    // shouldAdvanceTime — 가짜 타이머를 켜도 실제 시간이 같이 흐르게 해,
    // waitFor/findBy(실제 setInterval로 폴링)가 멈추지 않게 한다(아래
    // vi.advanceTimersByTime()로 900ms 지연만 직접 통제).
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('음원 파일을 고르면 미리보기 없이 바로 제목/업로드 폼을 보여줌', () => {
    render(<UploadScreen open onUploaded={() => {}} onCancel={() => {}} />)
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'my-song.mp3', { type: 'audio/mpeg' }))

    expect(screen.getByDisplayValue('my-song')).toBeInTheDocument() // 확장자 뺀 파일명이 제목 기본값
    expect(screen.getByRole('button', { name: '업로드' })).toBeInTheDocument()
    expect(importScoreFileMock).not.toHaveBeenCalled()
  })

  it('음원 업로드 제출 시 uploadAudioSong을 호출하고, 성공하면 완료 표시 후 onUploaded를 부름', async () => {
    const onUploaded = vi.fn()
    render(<UploadScreen open onUploaded={onUploaded} onCancel={() => {}} />)
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp4', { type: 'video/mp4' }))

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await waitFor(() => expect(uploadAudioSongMock).toHaveBeenCalledTimes(1))
    expect(uploadAudioSongMock).toHaveBeenCalledWith(expect.any(File), 'song', '')

    // 마이크로 인터랙션 — 버튼이 "업로드완료 ✓"로 바뀜
    expect(await screen.findByRole('button', { name: '업로드완료 ✓' })).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled() // 아직 지연 중

    vi.advanceTimersByTime(1000)
    expect(onUploaded).toHaveBeenCalledTimes(1)
  })

  it('모드A 지적(Low, 반영) — 업로드완료 표시 중 배경을 클릭해 취소하면, 지연된 타이머가 나중에 onUploaded를 또 부르지 않음', async () => {
    const onUploaded = vi.fn()
    const onCancel = vi.fn()
    render(<UploadScreen open onUploaded={onUploaded} onCancel={onCancel} />)
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await waitFor(() => expect(uploadAudioSongMock).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: '업로드완료 ✓' }) // 지연 타이머가 걸린 상태

    fireEvent.click(screen.getByRole('presentation')) // 배경 클릭으로 취소
    expect(onCancel).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000) // 원래 타이머가 발동했을 시점
    expect(onUploaded).not.toHaveBeenCalled() // 취소 후엔 절대 안 불려야 함
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
    render(<UploadScreen open onUploaded={() => {}} onCancel={() => {}} />)
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mid', { type: 'audio/midi' }))

    expect(await screen.findByText(/인식됨 — 노트 1개, BPM 140/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))
    await waitFor(() => expect(uploadSongMock).toHaveBeenCalledTimes(1))
    expect(uploadAudioSongMock).not.toHaveBeenCalled()
  })

  it('지원하지 않는 확장자는 에러를 보여주고 업로드 폼을 안 띄움', () => {
    render(<UploadScreen open onUploaded={() => {}} onCancel={() => {}} />)
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'photo.png', { type: 'image/png' }))

    expect(screen.getByText(/지원하지 않는 파일 형식입니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '업로드' })).not.toBeInTheDocument()
  })

  it('업로드 실패 시 에러 메시지를 보여주고 완료 표시로 넘어가지 않음', async () => {
    uploadAudioSongMock.mockRejectedValue(new ApiError(500, '서버 오류'))
    render(<UploadScreen open onUploaded={() => {}} onCancel={() => {}} />)
    const input = screen.getByLabelText('파일 선택') as HTMLInputElement
    selectFile(input, new File(['x'], 'song.mp3', { type: 'audio/mpeg' }))

    fireEvent.click(screen.getByRole('button', { name: '업로드' }))

    expect(await screen.findByText('서버 오류')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '업로드완료 ✓' })).not.toBeInTheDocument()
  })

  it('배경을 클릭하면 onCancel이 불림(잘못 눌렀을 수도 있으니)', () => {
    const onCancel = vi.fn()
    render(<UploadScreen open onUploaded={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('presentation'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
