import { useEffect, useState } from 'react'
import './styles/tokens.css'
import { fetchCurrentUser, type CurrentUser } from './api/auth'
import type { SongSummary } from './api/songs'
import { LoginScreen } from './features/auth/LoginScreen'
import { LibraryScreen } from './features/library/LibraryScreen'
import { UploadScreen } from './features/upload/UploadScreen'
import { PracticeCanvas } from './features/practice/PracticeCanvas'
import type { DrumScore } from './score/types'

// 라우팅 라이브러리 없이 상태로 화면을 전환한다 — 화면 4개뿐이고 URL 딥링크
// 요구사항이 없어 react-router-dom 추가는 과한 설계로 판단
// (work/T2-5/plan.md §설계 3, Codex 모드C 리스크 의견 C-007: 나중에 URL 공유·
// 뒤로가기가 필요해지면 이 선택을 재검토).
type Screen = 'checking' | 'login' | 'library' | 'upload' | 'practice'

function App() {
  const [screen, setScreen] = useState<Screen>('checking')
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [practiceSong, setPracticeSong] = useState<{
    song: SongSummary
    drumScore: DrumScore
  } | null>(null)

  useEffect(() => {
    fetchCurrentUser()
      .then((u) => {
        setUser(u)
        setScreen(u ? 'library' : 'login')
      })
      .catch(() => {
        // 로그인 상태를 확인할 수 없으면(서버 미응답 등) 로그인 화면을 보여준다 —
        // 빈 화면에 영원히 머무르는 것보다 사용자가 다시 시도할 수 있는 편이 낫다.
        setScreen('login')
      })
  }, [])

  if (screen === 'checking') {
    return <main style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }} />
  }

  if (screen === 'login' || !user) {
    return (
      <LoginScreen
        onLoggedIn={(loggedInUser) => {
          setUser(loggedInUser)
          setScreen('library')
        }}
      />
    )
  }

  if (screen === 'upload') {
    return (
      <UploadScreen onUploaded={() => setScreen('library')} onCancel={() => setScreen('library')} />
    )
  }

  if (screen === 'practice' && practiceSong) {
    return (
      <main
        style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', padding: 16 }}
      >
        <button onClick={() => setScreen('library')}>← 라이브러리</button>
        <h1 style={{ fontSize: '1.3rem' }}>
          {practiceSong.song.title}
          {practiceSong.song.artist && (
            <span style={{ color: 'var(--text-muted)' }}> — {practiceSong.song.artist}</span>
          )}
        </h1>
        <PracticeCanvas score={practiceSong.drumScore} />
      </main>
    )
  }

  return (
    <LibraryScreen
      onUpload={() => setScreen('upload')}
      onOpenSong={(song, drumScore) => {
        setPracticeSong({ song, drumScore })
        setScreen('practice')
      }}
      onLoggedOut={() => {
        setUser(null)
        setScreen('login')
      }}
    />
  )
}

export default App
