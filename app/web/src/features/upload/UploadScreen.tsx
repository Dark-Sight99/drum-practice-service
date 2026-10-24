import { useState } from 'react'
import { uploadSong } from '../../api/songs'
import { ApiError } from '../../api/client'
import { importScoreFile, validateDrumScore, type DrumScore } from '../../score'

export interface UploadScreenProps {
  onUploaded: () => void
  onCancel: () => void
}

const ACCEPT = '.mid,.midi,.musicxml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx'

// Phase 2는 디지털 악보(경로 C)만 — 음원/종이 악보 선택 UI는 그 경로들이 실제로
// 동작하는 Phase 3/4에서 추가(work/T2-5/plan.md §범위 "안 다룸").
export function UploadScreen({ onUploaded, onCancel }: UploadScreenProps) {
  const [file, setFile] = useState<File | null>(null)
  const [parsedScore, setParsedScore] = useState<DrumScore | null>(null)
  const [noteCount, setNoteCount] = useState(0)
  const [parseError, setParseError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setParsedScore(null)
    setParseError(null)
    setSubmitError(null)

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !parsedScore) return

    const validation = validateDrumScore(parsedScore)
    if (!validation.valid) {
      setSubmitError(`악보 데이터가 올바르지 않습니다: ${validation.errors.join(', ')}`)
      return
    }

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      await uploadSong(file, title.trim(), artist.trim(), parsedScore)
      onUploaded()
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : '업로드에 실패했습니다')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main
      style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', padding: 16 }}
    >
      <h1 style={{ fontSize: '1.3rem' }}>악보 업로드</h1>
      <p style={{ color: 'var(--text-muted)' }}>
        디지털 악보 파일(MIDI, MusicXML, Guitar Pro)만 지원합니다.
      </p>

      <input type="file" accept={ACCEPT} onChange={(e) => void handleFileChange(e)} />

      {parseError && <p style={{ color: 'var(--danger)' }}>{parseError}</p>}

      {parsedScore && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            marginTop: 'var(--space-4)',
            maxWidth: 320,
          }}
        >
          <p style={{ color: 'var(--success)' }}>
            인식됨 — 노트 {noteCount}개, BPM {parsedScore.meta.bpm}
          </p>
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
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '업로드 중…' : '업로드'}
            </button>
            <button type="button" onClick={onCancel}>
              취소
            </button>
          </div>
        </form>
      )}

      {!parsedScore && !parseError && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <button onClick={onCancel}>취소</button>
        </div>
      )}
    </main>
  )
}
