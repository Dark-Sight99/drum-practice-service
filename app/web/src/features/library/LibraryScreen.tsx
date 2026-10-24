import { useEffect, useState } from 'react'
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

export interface LibraryScreenProps {
  onUpload: () => void
  onOpenSong: (song: SongSummary, drumScore: DrumScore) => void
  onLoggedOut: () => void
}

const SOURCE_LABEL: Record<string, string> = {
  midi: 'MIDI',
  musicxml: 'MusicXML',
  gp: 'Guitar Pro',
  audio: '음원',
  omr: '종이 악보',
}

export function LibraryScreen({ onUpload, onOpenSong, onLoggedOut }: LibraryScreenProps) {
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
          <button onClick={onUpload}>+ 업로드</button>
          <button onClick={() => void handleLogout()}>로그아웃</button>
        </div>
      </div>

      <input
        placeholder="제목·아티스트 검색"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', maxWidth: 320, marginBottom: 'var(--space-4)' }}
      />

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>불러오는 중…</p>}
      {!loading && visibleSongs.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>
          {songs.length === 0 ? '아직 업로드한 곡이 없습니다.' : '검색 결과가 없습니다.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {visibleSongs.map((song) => (
          <div
            key={song.id}
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
              {renamingId === song.id ? (
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename(song.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(song.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- 인라인 이름변경 진입 시 바로 타이핑
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => void handleOpen(song)}
                  disabled={openingId === song.id}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text)',
                    textAlign: 'left',
                    padding: 0,
                    font: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <strong>{song.title}</strong>
                  {song.artist && (
                    <span style={{ color: 'var(--text-muted)' }}> — {song.artist}</span>
                  )}
                </button>
              )}
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {song.original_bpm != null ? `BPM ${song.original_bpm}` : 'BPM 미상'} ·{' '}
                {SOURCE_LABEL[song.source_type] ?? song.source_type} · {song.status}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
              <button onClick={() => startRename(song)}>이름변경</button>
              <button onClick={() => void handleDelete(song)}>삭제</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
