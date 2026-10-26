import { useEffect, useRef, useState } from 'react'
import { uploadAudioSong, uploadSong } from '../../api/songs'
import { ApiError } from '../../api/client'
import { importScoreFile, validateDrumScore, type DrumScore } from '../../score'
import { Modal } from '../../components/Modal'

export interface UploadScreenProps {
  open: boolean
  onUploaded: () => void
  onCancel: () => void
}

const DIGITAL_EXTENSIONS = ['.mid', '.midi', '.musicxml', '.mxl', '.gp', '.gp3', '.gp4', '.gp5', '.gpx']
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.flac', '.mp4']
const ACCEPT = [...DIGITAL_EXTENSIONS, ...AUDIO_EXTENSIONS].join(',')

type FileKind = 'digital' | 'audio'

function detectKind(filename: string): FileKind | null {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (DIGITAL_EXTENSIONS.includes(ext)) return 'digital'
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  return null
}

// T3-19(REQ-01/REQ-02, 2026-10-26 의뢰인 지적) — 지금까지 디지털 악보(MIDI/
// MusicXML/Guitar Pro)만 받던 업로드 창이 사실 일반 사용자가 흔히 가진 음원
// (mp3/mp4 등)은 받지 못했다(백엔드 `POST /songs/audio`는 T3-1/T3-2 때 이미
// 완성됐지만, 이 화면에서 호출하는 코드가 끝내 안 만들어졌던 빈틈). 종이 악보
// (Phase 4) 경로를 드롭하면서 음원 업로드가 사실상 유일한 주 경로가 돼 이번에
// 같이 연결. 확장자로 디지털/음원 경로를 자동 분기 — 디지털은 기존처럼
// 클라이언트에서 바로 파싱해 미리보기(노트 수·BPM)까지 보여주고, 음원은
// 서버가 분리·채보까지 자동으로 이어 하므로(핸들러가 분리 성공 시 채보
// 작업을 자동 큐잉, `modules/separator/handler.py`) 여기선 파일을 올리기만
// 하면 끝 — 업로드 자체가 끝나는 대로 "업로드완료" 표시 후 모달이 닫힘(의뢰인
// 요청 — 분리·채보는 몇 분 걸릴 수 있어 그걸 기다리게 하지 않음, 진행 상태는
// 라이브러리의 상태 표시로 확인).
export function UploadScreen({ open, onUploaded, onCancel }: UploadScreenProps) {
  const [file, setFile] = useState<File | null>(null)
  const [fileKind, setFileKind] = useState<FileKind | null>(null)
  const [parsedScore, setParsedScore] = useState<DrumScore | null>(null)
  const [noteCount, setNoteCount] = useState(0)
  const [parseError, setParseError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [justUploaded, setJustUploaded] = useState(false)
  // T3-19 모드A 지적(Low, 반영) — 업로드 성공 직후(마이크로 인터랙션 지연 중)
  // 사용자가 취소/배경 클릭/Esc로 모달을 닫으면, 안 지워진 타이머가 나중에
  // 그대로 발동해 resetState()·onUploaded()를 또 부르는 버그가 있었음 — 타이머
  // id를 들고 있다가 취소 시 확실히 지운다.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 모드A 재검토 지적(Low, 반영) — 위 타이머 정리만으론 "요청이 아직 진행
  // 중일 때(서버 응답 대기 중) 취소"하는 경로를 못 막았다 — 그 요청이 나중에
  // 응답하면 이미 취소된 뒤인데도 finishWithSuccessFeedback()/setSubmitError가
  // 그대로 불려 모달이 멋대로 "완료"로 바뀌거나 에러가 뜰 수 있었음. 처음엔
  // 단순 불리언 플래그(submitCancelledRef)로 고쳤는데, 모드A 3차 재검토에서
  // "취소 후 모달을 다시 열고 새로 제출하면 그 불리언이 false로 되돌아가,
  // 그 사이 뒤늦게 응답한 **이전(취소된) 제출**이 새 제출인 것처럼 통과해
  // 아직 안 끝난 새 업로드를 멋대로 완료 처리할 수 있다"는 지적을 받음 —
  // 불리언 대신 "제출 세대 번호"로 바꿔, 응답이 돌아왔을 때 그 응답이 **지금
  // 유효한 바로 그 제출**의 것인지(세대 번호 일치)까지 확인한다. 취소와 새
  // 제출 둘 다 번호를 올려 이전 세대를 무효화.
  const submitGenerationRef = useRef(0)

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current)
    }
  }, [])

  function resetState() {
    setFile(null)
    setFileKind(null)
    setParsedScore(null)
    setNoteCount(0)
    setParseError(null)
    setTitle('')
    setArtist('')
    setSubmitError(null)
    setIsSubmitting(false)
    setJustUploaded(false)
  }

  function handleCancel() {
    submitGenerationRef.current += 1 // 진행 중이던 제출이 있었다면 무효화
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current)
      successTimerRef.current = null
    }
    resetState()
    onCancel()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setParsedScore(null)
    setParseError(null)
    setSubmitError(null)

    const kind = detectKind(selected.name)
    setFileKind(kind)
    if (kind === null) {
      setParseError(
        '지원하지 않는 파일 형식입니다 — 음원(mp3/wav/m4a/flac/mp4) 또는 디지털 악보(MIDI/MusicXML/Guitar Pro) 파일을 선택해주세요.',
      )
      return
    }
    if (kind === 'audio') {
      setTitle(selected.name.slice(0, selected.name.lastIndexOf('.')))
      return
    }

    const bytes = new Uint8Array(await selected.arrayBuffer())
    const result = importScoreFile(bytes, selected.name)
    if (!result.ok) {
      setParseError(result.error)
      return
    }
    setParsedScore(result.score)
    setNoteCount(result.score.notes.length)
    setTitle(result.score.meta.title || selected.name)
  }

  function finishWithSuccessFeedback() {
    // 마이크로 인터랙션(의뢰인 요청) — 버튼이 "업로드완료 ✓"로 잠깐 바뀐 뒤
    // 모달이 스스로 닫히고 라이브러리로 돌아간다.
    setIsSubmitting(false)
    setJustUploaded(true)
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null
      resetState()
      onUploaded()
    }, 900)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !fileKind) return

    // 이번 제출의 "세대 번호" — 응답이 돌아왔을 때 아직 이 번호가 최신인지로
    // 그 사이 취소되거나 다른 제출로 덮어써지지 않았는지 확인한다.
    const mySubmitGeneration = ++submitGenerationRef.current
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      if (fileKind === 'digital') {
        if (!parsedScore) return
        const validation = validateDrumScore(parsedScore)
        if (!validation.valid) {
          setSubmitError(`악보 데이터가 올바르지 않습니다: ${validation.errors.join(', ')}`)
          setIsSubmitting(false)
          return
        }
        await uploadSong(file, title.trim(), artist.trim(), parsedScore)
      } else {
        await uploadAudioSong(file, title.trim(), artist.trim())
      }
      // 모드A 재검토 지적(Low, 반영) — 요청이 서버에 가 있는 동안 사용자가
      // 이미 취소했다면(또는 그 사이 새로 다른 파일을 제출했다면), 뒤늦게
      // 돌아온 이 응답으로 모달을 "완료" 상태로 되살리면 안 된다 — 세대
      // 번호가 그 사이 바뀌었으면(취소·재제출 둘 다 번호를 올림) 조용히 무시.
      if (mySubmitGeneration !== submitGenerationRef.current) return
      finishWithSuccessFeedback()
    } catch (err) {
      if (mySubmitGeneration !== submitGenerationRef.current) return
      setSubmitError(err instanceof ApiError ? err.message : '업로드에 실패했습니다')
      setIsSubmitting(false)
    }
  }

  const canSubmit =
    file !== null && fileKind !== null && (fileKind === 'audio' || parsedScore !== null)

  return (
    <Modal open={open} onClose={handleCancel} title="악보/음원 업로드">
      {/* 2026-10-26 의뢰인 요청 — 모달이 가로로 길쭉한 사각형이었던 걸 정사각형에
       * 가깝게(폭 고정 + 줄바꿈으로 세로 길이 확보), 안내 문구는 두 줄로,
       * 파일 선택·취소는 가운데 정렬. 폭을 너무 좁게(280) 잡으면 문구가 더
       * 쪼개져 4줄까지 밀렸던 걸 다시 넓혀 자연스럽게 2줄로 — 정확한 폭은
       * 브라우저로 실측해 맞춤(2026-10-26 재조정).
       *
       * 파일 input은 네이티브 "선택된 파일 없음" 텍스트가 버튼에 붙어 있어
       * 전체 너비가 가변적이라, flex justify-center로는 가운데로 안 왔다(의뢰인
       * 재지적) — input 자체는 시각적으로 숨기고 라벨을 버튼처럼 꾸며 가운데
       * 정렬하고, 고른 파일명은 그 아래 별도 줄로 보여준다. */}
      <div style={{ width: 360 }}>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          음원(mp3, wav, m4a, flac, mp4) 또는 디지털 악보(MIDI, MusicXML, Guitar Pro)를 올릴 수
          있습니다.
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-1)',
          }}
        >
          <label
            htmlFor="upload-file-input"
            style={{
              display: 'inline-block',
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-control)',
              cursor: 'pointer',
            }}
          >
            파일 선택
          </label>
          <input
            id="upload-file-input"
            type="file"
            accept={ACCEPT}
            onChange={(e) => void handleFileChange(e)}
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          />
          {file && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{file.name}</span>
          )}
        </div>

        {parseError && (
          <p style={{ color: 'var(--danger)', textAlign: 'center' }}>{parseError}</p>
        )}

        {fileKind === 'digital' && parsedScore && (
          <p style={{ color: 'var(--success)', textAlign: 'center' }}>
            인식됨 — 노트 {noteCount}개, BPM {parsedScore.meta.bpm}
          </p>
        )}

        {canSubmit && (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-4)',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              제목
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              아티스트(선택)
              <input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
            {submitError && <p style={{ color: 'var(--danger)' }}>{submitError}</p>}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
              <button type="submit" disabled={isSubmitting || justUploaded}>
                {justUploaded ? '업로드완료 ✓' : isSubmitting ? '업로드 중…' : '업로드'}
              </button>
              <button type="button" onClick={handleCancel}>
                취소
              </button>
            </div>
          </form>
        )}

        {!canSubmit && (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'center' }}>
            <button type="button" onClick={handleCancel}>
              취소
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
