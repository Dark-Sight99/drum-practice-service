import { useEffect, useRef, useState } from 'react'
import {
  fetchSong,
  fetchSongDrumScore,
  uploadAudioSong,
  uploadSong,
  type SongSummary,
} from '../../api/songs'
import { ApiError } from '../../api/client'
import { importScoreFile, validateDrumScore, type DrumScore } from '../../score'
import { Modal } from '../../components/Modal'
import { Spinner } from '../../components/Spinner'

export interface UploadScreenProps {
  open: boolean
  onUploaded: () => void
  onCancel: () => void
  /** 2026-10-26 의뢰인 요청 — 음원 업로드 직후(분리·채보가 아직 안 끝난
   * 상태) 라이브러리 목록에 "처리 중" 카드가 바로 보이게 — 모달은 안 닫고
   * 목록만 조용히 새로고침한다(onUploaded와 달리 모달을 닫지 않음). */
  onSongCreated: () => void
  /** 2026-10-26 의뢰인 요청 — 노트 생성이 끝나면 "연주하기" 버튼으로 바로
   * 그 곡의 연주 화면으로 이동. */
  onPlaySong: (song: SongSummary, drumScore: DrumScore) => void
}

const POLL_INTERVAL_MS = 2000
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

const DIGITAL_EXTENSIONS = [
  '.mid',
  '.midi',
  '.musicxml',
  '.mxl',
  '.gp',
  '.gp3',
  '.gp4',
  '.gp5',
  '.gpx',
]
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
// 서버가 분리·채보까지 자동으로 이어 한다(핸들러가 분리 성공 시 채보
// 작업을 자동 큐잉, `modules/separator/handler.py`). 디지털 악보는 업로드
// 자체가 끝나는 대로 "업로드완료" 표시 후 모달이 바로 닫히지만, 음원은
// 분리·채보가 몇 분 걸릴 수 있어 아래 generatingSong 상태로 전환해 모달
// 안에서 진행 상태를 보여준다(2026-10-26 의뢰인 요청 — 아래 generatingSong
// 코멘트 참고).
export function UploadScreen({
  open,
  onUploaded,
  onCancel,
  onSongCreated,
  onPlaySong,
}: UploadScreenProps) {
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
  // 모드A 지적(Medium, 반영) — 파일 input을 시각적으로 숨기면서(라벨을 버튼처럼
  // 꾸며 대신 보여줌) 키보드 포커스가 1x1px 안으로 들어가 안 보이게 됐다 —
  // 포커스 상태를 들고 있다가 라벨에 직접 포커스 링을 그려준다.
  const [fileInputFocused, setFileInputFocused] = useState(false)
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
  // 2026-10-26 의뢰인 요청 — 음원 업로드가 끝나면(파일만 올라간 상태) 모달을
  // 바로 닫는 대신, 분리·채보가 끝날 때까지 이 안에서 상태를 보여준다("이제
  // 뭘 해야 하는지 모르겠다"는 신규 사용자 지적 — 처리중 카드만 보여주고
  // 모달이 사라지면 안내가 끊김). generatingSong이 있으면 그 상태(pending/
  // processing/completed/failed)에 맞춰 스피너→연주하기 버튼/실패 안내로
  // 전환.
  const [generatingSong, setGeneratingSong] = useState<SongSummary | null>(null)
  // 폴링 실패 시(네트워크 일시 오류 등) 재시도를 예약하기 위한 더미 트리거 —
  // generatingSong 객체 자체는 안 바뀌어도 이 값을 올리면 아래 effect가 다시
  // 돈다.
  const [pollTick, setPollTick] = useState(0)
  const [isFetchingScore, setIsFetchingScore] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) clearTimeout(successTimerRef.current)
    }
  }, [])

  // 노트 생성 진행 상태 폴링 — 완료/실패(terminal) 상태가 되면 더 이상 예약하지
  // 않아 자연히 멈춘다. 2026-10-27(의뢰인 요청) — 생성 중(非terminal)에는
  // 아래 Modal onClose가 막혀 있어 모달 자체를 못 닫으므로, 이 effect가
  // cleanup될 일은 완료/실패로 끝나거나(둘 다 이 effect가 아예 재실행 안 함)
  // 실제로 언마운트될 때뿐이다.
  useEffect(() => {
    if (!generatingSong || TERMINAL_STATUSES.has(generatingSong.status)) return
    let cancelled = false
    const timer = setTimeout(() => {
      fetchSong(generatingSong.id)
        .then((latest) => {
          if (!cancelled) setGeneratingSong(latest)
        })
        .catch(() => {
          if (!cancelled) setPollTick((t) => t + 1) // 실패해도 다음 폴링을 다시 예약
        })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [generatingSong, pollTick])

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
    setGeneratingSong(null)
    setPollTick(0)
    setIsFetchingScore(false)
    setPlayError(null)
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
        // Codex 모드A 지적(필수, 반영) — canSubmit 가드 때문에 지금은 이
        // 분기에 도달할 때 parsedScore가 항상 있어야 하지만("방어적" 체크),
        // 혹시라도 도달하면 위에서 이미 true로 올린 isSubmitting을 안
        // 돌려놓고 그냥 return해 모달이 "업로드 중…"에 영원히 멈췄다 — 위
        // Modal onClose/취소 버튼 숨김 변경으로 그 상태에선 닫을 방법도
        // 없어져 진짜 막다른 상태가 됨. 바로 아래 검증 실패 분기와 같은
        // 패턴으로 돌려놓는다.
        if (!parsedScore) {
          setIsSubmitting(false)
          return
        }
        const validation = validateDrumScore(parsedScore)
        if (!validation.valid) {
          setSubmitError(`악보 데이터가 올바르지 않습니다: ${validation.errors.join(', ')}`)
          setIsSubmitting(false)
          return
        }
        await uploadSong(file, title.trim(), artist.trim(), parsedScore)
        // 모드A 재검토 지적(Low, 반영) — 요청이 서버에 가 있는 동안 사용자가
        // 이미 취소했다면(또는 그 사이 새로 다른 파일을 제출했다면), 뒤늦게
        // 돌아온 이 응답으로 모달을 "완료" 상태로 되살리면 안 된다 — 세대
        // 번호가 그 사이 바뀌었으면(취소·재제출 둘 다 번호를 올림) 조용히 무시.
        if (mySubmitGeneration !== submitGenerationRef.current) return
        finishWithSuccessFeedback()
      } else {
        // 2026-10-26 의뢰인 요청 — 음원은 업로드만으론 안 끝남(분리·채보가
        // 이어서 돈다) — digital 경로처럼 바로 "완료"로 넘기지 않고, 목록만
        // 조용히 새로고침(onSongCreated — "처리 중" 카드가 바로 보이게)한 뒤
        // 모달 안에서 진행 상태를 보여주는 화면으로 전환한다.
        const { song } = await uploadAudioSong(file, title.trim(), artist.trim())
        if (mySubmitGeneration !== submitGenerationRef.current) return
        setIsSubmitting(false)
        onSongCreated()
        setGeneratingSong(song)
      }
    } catch (err) {
      if (mySubmitGeneration !== submitGenerationRef.current) return
      setSubmitError(err instanceof ApiError ? err.message : '업로드에 실패했습니다')
      setIsSubmitting(false)
    }
  }

  async function handlePlayGenerated() {
    if (!generatingSong) return
    // 모드A 지적(필수, 반영) — DrumScore를 가져오는 도중 사용자가 배경
    // 클릭·Esc·닫기로 모달을 먼저 닫으면(handleCancel이 submitGenerationRef를
    // 올림), 뒤늦게 도착한 응답으로 onPlaySong이 불려 이미 닫은 모달에서
    // 느닷없이 연주 화면으로 넘어가 버릴 수 있었다 — 업로드 제출과 같은
    // 세대 번호 가드를 재사용(이 ref는 "이 모달 세션에서 지금 유효한 비동기
    // 작업이 맞는지"를 범용으로 추적).
    const myGeneration = ++submitGenerationRef.current
    setPlayError(null)
    setIsFetchingScore(true)
    try {
      const drumScore = await fetchSongDrumScore(generatingSong.id)
      if (myGeneration !== submitGenerationRef.current) return // 그 사이 닫혔으면 무시
      onPlaySong(generatingSong, drumScore)
      resetState()
      onCancel() // 모달 닫기만 — 완료 토스트는 필요 없음(바로 연주 화면으로 이동)
    } catch (err) {
      if (myGeneration !== submitGenerationRef.current) return
      setPlayError(err instanceof ApiError ? err.message : '곡을 여는 데 실패했습니다')
      setIsFetchingScore(false)
    }
  }

  const canSubmit =
    file !== null && fileKind !== null && (fileKind === 'audio' || parsedScore !== null)
  // 2026-10-27(의뢰인 요청) — "노트를 생성하는 중…" 화면(완료/실패 전)에서
  // 배경을 눌러도 모달이 안 닫히게 — 이 상태에서 모달이 사라지면 사용자가
  // 이 곡이 어떻게 됐는지 다시 확인할 방법이 라이브러리 새로고침뿐이라
  // 혼란스러울 수 있음(아래 "닫기" 버튼·안내 문구 제거와 같은 취지).
  // 완료/실패(terminal)로 끝나면 다시 닫을 수 있다.
  const isGeneratingInProgress =
    generatingSong !== null && !TERMINAL_STATUSES.has(generatingSong.status)

  return (
    // 2026-10-27(의뢰인 요청) — "업로드 중에 취소를 눌러도 [서버 쪽은]
    // 계속 진행된다"는 지적(handleCancel은 실제 요청을 중단시키지 않고
    // 세대 번호만 올려 응답을 무시할 뿐 — 위 submitGenerationRef 코멘트
    // 참고, 진짜로 취소되는 게 아니라 오해를 살 수 있음) — 업로드 요청이
    // 실제로 오가는 동안(isSubmitting)과 노트 생성 중(isGeneratingInProgress)엔
    // 배경 클릭·Esc로도 모달이 안 닫히게 막는다(onClose를 아무 일도 안 하는
    // 함수로 교체).
    <Modal
      open={open}
      onClose={isSubmitting || isGeneratingInProgress ? () => {} : handleCancel}
      title="악보/음원 업로드"
    >
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
        {generatingSong ? (
          // 2026-10-26 의뢰인 요청 — "업로드완료 ✓" 후 모달이 사라지고 카드의
          // "처리 중…" 문구만 남으면 신규 사용자가 다음에 뭘 해야 할지 모른다는
          // 지적 — 분리·채보가 끝날 때까지 모달 안에서 진행 상태를 보여주고,
          // 끝나면 "연주하기" 버튼으로 바로 연주 화면까지 이어준다.
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-4) 0',
            }}
          >
            {generatingSong.status === 'completed' ? (
              <>
                <span style={{ fontSize: '2rem', color: 'var(--success)' }}>✓</span>
                <p style={{ textAlign: 'center', margin: 0 }}>노트 생성이 완료됐어요!</p>
                {playError && (
                  <p style={{ color: 'var(--danger)', textAlign: 'center', margin: 0 }}>
                    {playError}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={() => void handlePlayGenerated()}
                    disabled={isFetchingScore}
                  >
                    {isFetchingScore ? '여는 중…' : '연주하기'}
                  </button>
                  <button type="button" onClick={handleCancel}>
                    닫기
                  </button>
                </div>
              </>
            ) : generatingSong.status === 'failed' ? (
              <>
                <span style={{ fontSize: '2rem', color: 'var(--danger)' }}>✕</span>
                <p style={{ color: 'var(--danger)', textAlign: 'center', margin: 0 }}>
                  노트 생성에 실패했습니다. 라이브러리에서 다시 시도해주세요.
                </p>
                <button type="button" onClick={handleCancel}>
                  닫기
                </button>
              </>
            ) : (
              // 2026-10-27(의뢰인 요청) — "창을 닫아도 처리는 계속돼요" 안내와
              // "닫기" 버튼을 없앰 — 위 Modal onClose가 이 단계(완료/실패 전)엔
              // 배경 클릭·Esc도 막아 실제로 닫을 방법이 없으므로, 닫을 수 있다는
              // 인상을 주는 문구·버튼을 같이 없애는 게 맞다(실제로 안 되는 걸
              // 된다고 암시하면 안 된다는 원칙 — T3-35 취소 버튼 제거와 같은 맥락).
              <>
                <Spinner />
                <p style={{ textAlign: 'center', margin: 0 }}>노트를 생성하는 중…</p>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    textAlign: 'center',
                    margin: 0,
                  }}
                >
                  곡 길이에 따라 몇 분 걸릴 수 있어요.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
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
              {/* 2026-10-26 — 버튼 호버·트랜지션이 전역 .btn 클래스(index.css)로
               * 옮겨가서 여기선 포커스 링(상태 기반이라 JS로 유지)만 따로 그린다. */}
              <label
                htmlFor="upload-file-input"
                className="btn"
                style={{
                  outline: fileInputFocused ? '2px solid var(--accent)' : 'none',
                  outlineOffset: 2,
                }}
              >
                파일 선택
              </label>
              <input
                id="upload-file-input"
                type="file"
                accept={ACCEPT}
                onChange={(e) => void handleFileChange(e)}
                // 모드A 재검토 지적(Low, 반영) — 그냥 :focus면 마우스로 라벨을
                // 클릭해 포커스가 가도 링이 뜸(의도한 "키보드 포커스 표시"가
                // 아님) — :focus-visible로 키보드 등 실제 필요한 경우에만.
                onFocus={(e) => setFileInputFocused(e.target.matches(':focus-visible'))}
                onBlur={() => setFileInputFocused(false)}
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
                  {/* 2026-10-27(의뢰인 요청) — 위 Modal onClose 코멘트와 같은
                   * 이유로, 실제로 취소되지 않는 "취소" 버튼을 업로드 요청이
                   * 오가는 동안은 아예 안 보여준다. */}
                  {!isSubmitting && (
                    <button type="button" onClick={handleCancel}>
                      취소
                    </button>
                  )}
                </div>
              </form>
            )}

            {!canSubmit && (
              <div
                style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'center' }}
              >
                <button type="button" onClick={handleCancel}>
                  취소
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
