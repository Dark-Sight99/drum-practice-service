import { useEffect, useState } from 'react'
import './styles/tokens.css'
import { fetchCurrentUser, type CurrentUser } from './api/auth'
import type { SongSummary } from './api/songs'
import { LoginScreen } from './features/auth/LoginScreen'
import { LibraryScreen } from './features/library/LibraryScreen'
import { PracticeCanvas } from './features/practice/PracticeCanvas'
import { EditorScreen } from './features/editor/EditorScreen'
import { Skeleton } from './components/Skeleton'
import type { DrumScore } from './score/types'

// 라우팅 라이브러리 없이 상태로 화면을 전환한다 — 화면 수가 적고 URL 딥링크
// 요구사항이 없어 react-router-dom 추가는 과한 설계로 판단
// (work/T2-5/plan.md §설계 3, Codex 모드C 리스크 의견 C-007: 나중에 URL 공유·
// 뒤로가기가 필요해지면 이 선택을 재검토).
// T3-19(2026-10-26) — 업로드는 더 이상 독립 화면이 아니라 LibraryScreen이
// 내부적으로 띄우는 모달이라 'upload'는 여기서 제거.
type Screen = 'checking' | 'login' | 'library' | 'practice' | 'editor'

function App() {
  const [screen, setScreen] = useState<Screen>('checking')
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [practiceSong, setPracticeSong] = useState<{
    song: SongSummary
    drumScore: DrumScore
  } | null>(null)
  const [editingSong, setEditingSong] = useState<{
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
    // 2026-10-26 의뢰인 요청 — 로그인 상태 확인 중 빈 화면 대신 스켈레톤.
    // 로그인/라이브러리 어느 쪽이 될지 아직 모르므로 특정 레이아웃을 흉내내지
    // 않고 가벼운 placeholder만 보여준다.
    return (
      <main
        style={{
          background: 'var(--bg)',
          color: 'var(--text)',
          minHeight: '100vh',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <Skeleton width={160} height={24} />
        <Skeleton width="100%" height={48} />
        <Skeleton width="100%" height={48} />
      </main>
    )
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

  if (screen === 'practice' && practiceSong) {
    return (
      // 2026-10-28(의뢰인 요청) — "휠로 내리지 않으면 아래 문구까지 안 보인다,
      // 드래그 없이 한 페이지에 다 보이게 노트 위치를 좀 올려도 되지 않을까" —
      // 넓은 화면(레인/킷 좌우 배치, PracticeCanvas.tsx의 isKitStacked)에서
      // 레인 높이를 600px 고정값으로 두니 실측 결과(1366×768처럼 흔한 노트북
      // 해상도) 스크롤이 실제로 필요했다. 뷰포트 높이를 그대로 쓰는 대신
      // (고정 600이 화면마다 맞거나 안 맞거나 하므로) `<main>`을 정확히
      // 100vh로 고정하고 flex:1로 남는 높이를 PracticeCanvas에 그대로
      // 넘겨, 그 안의 레인이 "남는 높이만큼" 스스로 늘어나게 한다 — 화면이
      // 크면 더 길게, 작으면 그만큼 줄어들어 항상 한 화면에 맞는다.
      // `overflow: auto`는 그래도 안 맞는 극단적으로 작은 창(레인
      // 최소높이보다 작은 경우)의 안전망일 뿐, 평소엔 스크롤바가 안 생긴다.
      <main
        style={{
          background: 'var(--bg)',
          color: 'var(--text)',
          height: '100vh',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          overflow: 'auto',
        }}
      >
        {/* 2026-10-28(의뢰인 요청, 6차) — flex column으로 바꾸면서 버튼이
         * 기본 alignItems:stretch 때문에 가로 전체 폭으로 늘어나 버렸다
         * ("라이브러리 버튼을 한 줄 꽉 차게 해달라는 게 아니었다" 지적) —
         * alignSelf:flex-start로 원래 내용 크기만큼으로 되돌림. */}
        <button
          style={{ flexShrink: 0, alignSelf: 'flex-start' }}
          onClick={() => setScreen('library')}
        >
          ← 라이브러리
        </button>
        <h1 style={{ fontSize: '1.3rem', flexShrink: 0, margin: 0 }}>
          {practiceSong.song.title}
          {practiceSong.song.artist && (
            <span style={{ color: 'var(--text-muted)' }}> — {practiceSong.song.artist}</span>
          )}
        </h1>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PracticeCanvas
            score={practiceSong.drumScore}
            songId={practiceSong.song.id}
            availableAudioKinds={practiceSong.song.available_audio_kinds}
          />
        </div>
      </main>
    )
  }

  if (screen === 'editor' && editingSong) {
    return (
      <main
        style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', padding: 16 }}
      >
        <h1 style={{ fontSize: '1.3rem' }}>
          편집: {editingSong.song.title}
          {editingSong.song.artist && (
            <span style={{ color: 'var(--text-muted)' }}> — {editingSong.song.artist}</span>
          )}
        </h1>
        <EditorScreen
          song={editingSong.song}
          initialScore={editingSong.drumScore}
          onSaved={() => setScreen('library')}
          onCancel={() => setScreen('library')}
        />
      </main>
    )
  }

  return (
    <LibraryScreen
      onOpenSong={(song, drumScore) => {
        setPracticeSong({ song, drumScore })
        setScreen('practice')
      }}
      onEditSong={(song, drumScore) => {
        setEditingSong({ song, drumScore })
        setScreen('editor')
      }}
      onLoggedOut={() => {
        setUser(null)
        setScreen('login')
      }}
    />
  )
}

export default App
