import { useEffect, useRef, useState } from 'react'
import {
  deleteSong,
  fetchSongDrumScore,
  listSongs,
  renameSong,
  type SongSummary,
} from '../../api/songs'
import { logout } from '../../api/auth'
import { ApiError } from '../../api/client'
import type { DrumScore } from '../../score/types'
import { filterSongs } from './filterSongs'
import { UploadScreen } from '../upload/UploadScreen'
import { Toast } from '../../components/Toast'
import { SongCardSkeleton } from '../../components/Skeleton'

export interface LibraryScreenProps {
  onOpenSong: (song: SongSummary, drumScore: DrumScore) => void
  onEditSong: (song: SongSummary, drumScore: DrumScore) => void
  onLoggedOut: () => void
}

// 2026-10-26 — 종이 악보(OMR) 경로 드롭으로 'omr' 제거(intent/01-vision.md
// "2026-10-26 갱신" 참고).
const SOURCE_LABEL: Record<string, string> = {
  midi: 'MIDI',
  musicxml: 'MusicXML',
  gp: 'Guitar Pro',
  audio: '음원',
}

// T3-19 모드A 지적 후 추가 발견(2026-10-26, 의뢰인 실사용 중 재발견) — 음원
// 업로드가 생기면서 "분리·채보가 아직 안 끝난 곡"이 라이브러리에 훨씬 더
// 흔하게(몇 분씩) 떠 있게 됐는데, 그 상태에서 "열기"/"편집"을 눌러도 막는
// 게 없어 아직 없는 DrumScore를 조회하다 "DrumScore를 찾을 수 없습니다"
// 에러가 그대로 사용자에게 보였음(실제로 재현됨, 의뢰인 스크린샷). 처리가
// 끝난(`completed`) 곡만 열 수 있게 막고, 상태도 영어 원문 대신 한글로
// 보여준다.
const STATUS_LABEL: Record<string, string> = {
  pending: '대기 중',
  processing: '처리 중…',
  completed: '완료',
  failed: '실패',
}

export function LibraryScreen({ onOpenSong, onEditSong, onLoggedOut }: LibraryScreenProps) {
  // T3-19(2026-10-26 의뢰인 요청) — 업로드를 별도 화면(전체 페이지 전환)이
  // 아니라 모달로 띄운다. 업로드 완료 시 목록을 다시 불러와 새 곡이 바로
  // 보이게 한다.
  const [uploadOpen, setUploadOpen] = useState(false)
  // 2026-10-26 의뢰인 요청 — 업로드 완료 토스트. 모달은 완료 후 스스로 닫히므로
  // (onUploaded) 토스트는 모달 바깥(라이브러리 화면)에서 띄운다.
  // 모드A 재검토 지적(반영) — 메시지 문구가 매번 동일해서 토스트가 떠 있는
  // 도중 또 업로드를 완료하면(연속 업로드) state는 바뀌지만 React가 같은
  // Toast 인스턴스로 보고 다시 마운트하지 않아, 두 번째 완료의 타이머가
  // 첫 번째 타이머를 그대로 이어받아 3초를 못 채우고 사라질 수 있었음 —
  // 매 완료마다 증가하는 id를 key로 줘서 항상 새 인스턴스로 마운트시킨다.
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const toastIdRef = useRef(0)
  const [songs, setSongs] = useState<SongSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [openingId, setOpeningId] = useState<number | null>(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      setSongs(await listSongs())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // oxlint react(set-state-in-effect)가 여기서도 걸리지만, 이건 그 규칙이 막으려는
    // "렌더에서 바로 구할 수 있는 값을 괜히 effect로 재계산"하는 경우가 아니라 마운트
    // 시 서버에서 목록을 가져오는 전형적인 데이터 페칭이다 — React 공식 문서도 "외부
    // 시스템과 동기화"(fetch 포함)를 useEffect의 정석 용례로 든다. "이벤트에서
    // 갱신하라"는 대안도 적용 안 됨(마운트 자체가 이벤트라 옮길 핸들러가 없음).
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [])

  async function handleOpen(song: SongSummary) {
    setOpeningId(song.id)
    setError(null)
    try {
      const drumScore = await fetchSongDrumScore(song.id)
      onOpenSong(song, drumScore)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '곡을 여는 데 실패했습니다')
    } finally {
      setOpeningId(null)
    }
  }

  async function handleEdit(song: SongSummary) {
    setOpeningId(song.id)
    setError(null)
    try {
      const drumScore = await fetchSongDrumScore(song.id)
      onEditSong(song, drumScore)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '곡을 여는 데 실패했습니다')
    } finally {
      setOpeningId(null)
    }
  }

  function startRename(song: SongSummary) {
    setRenamingId(song.id)
    setRenameValue(song.title)
  }

  async function commitRename(id: number) {
    const title = renameValue.trim()
    if (!title) {
      setRenamingId(null)
      return
    }
    try {
      const updated = await renameSong(id, { title })
      setSongs((prev) => prev.map((s) => (s.id === id ? updated : s)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '이름 변경에 실패했습니다')
    } finally {
      setRenamingId(null)
    }
  }

  async function handleDelete(song: SongSummary) {
    if (!window.confirm(`"${song.title}"을(를) 삭제할까요?`)) return
    try {
      await deleteSong(song.id)
      setSongs((prev) => prev.filter((s) => s.id !== song.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '삭제에 실패했습니다')
    }
  }

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  const visibleSongs = filterSongs(songs, query)

  return (
    <main
      style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', padding: 16 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>라이브러리</h1>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button onClick={() => setUploadOpen(true)}>+ 업로드</button>
          <button onClick={() => void handleLogout()}>로그아웃</button>
        </div>
      </div>

      <UploadScreen
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false)
          toastIdRef.current += 1
          setToast({ id: toastIdRef.current, message: '✓ 업로드가 완료되었습니다' })
          void reload()
        }}
      />

      {toast && (
        <Toast key={toast.id} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      <input
        placeholder="제목·아티스트 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', maxWidth: 320, marginBottom: 'var(--space-4)' }}
      />

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* 2026-10-26 의뢰인 요청 — "불러오는 중…" 문구 대신 스켈레톤. 몇 줄이
           * 뜰지 미리 알 수 없어 적당한 개수(5)만 흉내낸다. */}
          {Array.from({ length: 5 }, (_, i) => (
            <SongCardSkeleton key={i} />
          ))}
        </div>
      )}
      {!loading && visibleSongs.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>
          {songs.length === 0 ? '아직 업로드한 곡이 없습니다.' : '검색 결과가 없습니다.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {visibleSongs.map((song) => {
          const isReady = song.status === 'completed'
          const isRenaming = renamingId === song.id
          // 2026-10-26 의뢰인 요청 — 카드 빈 곳을 눌러도 연주 화면으로 이동(지금까지는
          // 제목 글자만 버튼이었음). 처리가 안 끝났거나(열 게 없음) 이름을 바꾸는
          // 중이거나(입력창 클릭이 이동으로 오인되면 안 됨) 이미 여는 중이면 비활성.
          const clickable = isReady && !isRenaming && openingId !== song.id
          return (
            <div
              key={song.id}
              className={clickable ? 'song-card song-card--clickable' : 'song-card'}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? () => void handleOpen(song) : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      void handleOpen(song)
                    }
                  : undefined
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                background: 'var(--surface)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {isRenaming ? (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(song.id)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') void commitRename(song.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- 인라인 이름변경 진입 시 바로 타이핑
                    autoFocus
                  />
                ) : (
                  <span>
                    <strong>{song.title}</strong>
                    {song.artist && (
                      <span style={{ color: 'var(--text-muted)' }}> — {song.artist}</span>
                    )}
                  </span>
                )}
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {song.original_bpm != null ? `BPM ${song.original_bpm}` : 'BPM 미상'} ·{' '}
                  {SOURCE_LABEL[song.source_type] ?? song.source_type} ·{' '}
                  <span style={{ color: song.status === 'failed' ? 'var(--danger)' : undefined }}>
                    {STATUS_LABEL[song.status] ?? song.status}
                  </span>
                </div>
              </div>
              {/* 카드 전체가 클릭 영역이라, 여기 버튼들의 클릭·키 입력은 카드로
               * 안 퍼지게(stopPropagation) 막아야 "편집" 등을 눌렀는데 동시에
               * 연주 화면으로도 넘어가는 일이 없다. */}
              <div
                style={{ display: 'flex', gap: 'var(--space-1)' }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => void handleEdit(song)}
                  disabled={!isReady || openingId === song.id}
                  title={isReady ? undefined : '처리가 끝나야 편집할 수 있습니다'}
                >
                  편집
                </button>
                <button onClick={() => startRename(song)}>이름변경</button>
                <button onClick={() => void handleDelete(song)}>삭제</button>
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
