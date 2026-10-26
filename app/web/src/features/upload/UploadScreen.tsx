import { useState } from 'react'
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
    setTimeout(() => {
      resetState()
      onUploaded()
    }, 900)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !fileKind) return

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
      finishWithSuccessFeedback()
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : '업로드에 실패했습니다')
      setIsSubmitting(false)
    }
  }

  const canSubmit =
    file !== null && fileKind !== null && (fileKind === 'audio' || parsedScore !== null)

  return (
    <Modal open={open} onClose={handleCancel} title="악보/음원 업로드">
      <p style={{ color: 'var(--text-muted)' }}>
        음원(mp3, wav, m4a, flac, mp4) 또는 디지털 악보(MIDI, MusicXML, Guitar Pro)를 올릴 수
        있습니다.
      </p>

      <input
        type="file"
        aria-label="파일 선택"
        accept={ACCEPT}
        onChange={(e) => void handleFileChange(e)}
      />

      {parseError && <p style={{ color: 'var(--danger)' }}>{parseError}</p>}

      {fileKind === 'digital' && parsedScore && (
        <p style={{ color: 'var(--success)' }}>
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
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
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
        <div style={{ marginTop: 'var(--space-4)' }}>
          <button type="button" onClick={handleCancel}>
            취소
          </button>
        </div>
      )}
    </Modal>
  )
}
