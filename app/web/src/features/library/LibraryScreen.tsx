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
  // 모드A 4차 재검토 지적(필수 1건 + 리스크 의견 1건, 반영) — "로딩 끝"을
  // 별도의 loading state로 두고 reload()/silentReload() 양쪽이 각자 세대
  // 번호·useEffect로 동기화한 ref까지 맞물려 토글하던 구조가, 네 라운드에
  // 걸쳐 경계 사례(성공 경합·실패 경합·ref가 useEffect 타이밍차로 묵은 값을
  // 읽는 경우)를 하나씩 놓치며 계속 구멍이 났다 — "아직 한 번도 못 불러왔다"는
  // 사실 자체를 songs=null로 표현하면 loading은 그로부터 그냥 계산해낼 수
  // 있어(파생값, 별도 state 불필요) 어긋날 여지가 원천적으로 없어진다.
  const [songs, setSongs] = useState<SongSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = songs === null && error === null
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [openingId, setOpeningId] = useState<number | null>(null)

  // 모드A 지적(필수, 반영. 7차 재검토에서 범위를 reload()/silentReload()
  // 뿐 아니라 commitRename()/handleDelete()까지 넓힘) — songs를 바꾸는
  // 비동기 작업(목록 재조회·이름변경·삭제)이 여러 개 겹쳐 돌 수 있다(배경
  // 폴링 도중 이름변경·삭제, 같은 곡을 연달아 두 번 이름변경 등). 응답이
  // 시작한 순서와 다르게 도착하면(네트워크 지연) 더 오래된(먼저 시작한)
  // 작업의 응답이 나중에 와서 이미 최신으로 갱신된 songs를 옛 상태로
  // 덮어쓸 수 있었음(완료된 곡이 다시 "처리 중"으로 보이거나, 바꾼 이름이
  // 되돌아가거나, 지운 곡이 되살아나는 식) — songs를 바꾸는 모든 작업이
  // 이 하나의 세대 번호를 공유해, 자기 시작 이후 더 최신 작업이 있었으면
  // 응답을 무시한다(UploadScreen의 submitGenerationRef와 같은 패턴).
  const songsFetchGenerationRef = useRef(0)
  // songs state의 "지금 당장" 값을 미러 — 과거엔 이걸 useEffect로 동기화
  // 했는데(모드A 4차 재검토 지적), setState 호출과 effect 실행 사이에 생기는
  // 비동기 틈 사이로 다른 응답의 catch가 끼어들면 묵은 값을 읽을 수 있었다.
  // 여기선 setSongs를 부르는 바로 그 자리에서 함께 갱신해 그 틈 자체가
  // 없다.
  const songsRef = useRef<SongSummary[] | null>(null)

  // 2026-10-26/27 의뢰인 요청 — 목록을 (다시) 불러온다. silent=false(reload,
  // 마운트·업로드 직후)는 실패를 에러 배너로 보여준다. silent=true(배경
  // 폴링)는 "이미 목록이 떠 있는 상태"의 일시적 실패를 조용히 무시하고 다음
  // 폴링에서 재시도한다 — 단, 아직 한 번도 못 불러온 상태(songsRef.current
  // ===null)에서 실패하면 silent 여부와 무관하게 에러를 보여준다(그렇지
  // 않으면 아무도 안 꺼내주는 스켈레톤만 영원히 남는다 — 배경 폴링 자체도
  // songs가 비어 있는 한 시작을 안 해 재시도 기회조차 없음, 모드A 4차
  // 재검토 지적).
  async function fetchSongs({ silent }: { silent: boolean }) {
    const generation = ++songsFetchGenerationRef.current
    // 모드A 5차 재검토 지적(필수, 반영) — 첫 로딩이 실패해 error가 설정된
    // 뒤(songs는 여전히 null) reload()로 재시도하면, 여기서 error를 안 지우면
    // loading(=songs null && error null)이 계속 false라 스켈레톤도 안 뜨고
    // 그냥 옛 에러 문구만 그대로 보여서 재시도가 진행 중인지 전혀 알 수
    // 없었다 — 이전 reload()가 시작하자마자 error부터 지우던 동작을 복원.
    // silent(배경 폴링)는 안 지운다 — 이미 목록이 있는 상태에서의 일시적
    // 폴링 실패 중간에 에러를 조용히 지웠다 다시 켰다 하며 화면이 깜빡일
    // 이유가 없고, 애초에 silent는 songs가 비어 있는 한 시작도 안 함.
    if (!silent) setError(null)
    try {
      const latest = await listSongs()
      if (generation !== songsFetchGenerationRef.current) return
      songsRef.current = latest
      setSongs(latest)
      setError(null)
    } catch (err) {
      if (generation !== songsFetchGenerationRef.current) return
      if (!silent || songsRef.current === null) {
        setError(err instanceof ApiError ? err.message : '목록을 불러오지 못했습니다')
      }
    }
  }

  function reload() {
    return fetchSongs({ silent: false })
  }

  function silentReload() {
    return fetchSongs({ silent: true })
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

  // 2026-10-26 의뢰인 요청 — "노트 생성이 끝나면 사용자가 스스로 새로고침하지
  // 않아도 되게" — 처리 중(pending/processing)인 곡이 하나라도 있으면 몇 초
  // 간격으로 조용히 목록을 다시 불러온다. 다 끝나면(다음 reload에서 pending/
  // processing이 하나도 안 남으면) 이 effect가 다시 돌 때 조건을 안 만족해
  // 자연히 멈춘다 — 업로드 모달을 닫고 나가도(모달과 무관하게 이 화면이 계속
  // 떠 있는 한) 계속 돈다.
  useEffect(() => {
    const hasPending = (songs ?? []).some(
      (s) => s.status === 'pending' || s.status === 'processing',
    )
    if (!hasPending) return
    const timer = setInterval(() => {
      void silentReload()
    }, 2000)
    return () => clearInterval(timer)
  }, [songs])

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

  // 모드A 7차 재검토 지적(필수, 반영) — commitRename()이 songsFetchGenerationRef를
  // "올리기"만 하고(목록 재조회를 무효화) 자기 자신은 그 번호를 "확인"하지
  // 않아서, 같은 곡을 연달아 두 번 이름변경(예: Enter로 커밋했는데 요청이
  // 아직 안 끝난 사이 입력창이 그대로 열려 있어 — renamingId는 finally에서만
  // 풀림 — 값을 또 바꾸고 blur)하면 두 renameSong() 요청이 동시에 떠 있을
  // 수 있었다. 응답이 보낸 순서와 다르게 도착하면(네트워크 지연) 나중에
  // 보낸(최신) 제목이 먼저 반영됐다가 먼저 보낸(낡은) 제목이 뒤늦게 와서
  // 덮어쓸 수 있었음 — fetchSongs와 같은 세대 번호를 commitRename/
  // handleDelete도 "확인"하게 통합해(한 카운터가 조회·이름변경·삭제 전부를
  // 아우름), 뭐가 됐든 가장 나중에 시작된 작업의 응답만 반영되게 한다.
  async function commitRename(id: number) {
    const title = renameValue.trim()
    if (!title) {
      songsFetchGenerationRef.current += 1 // 혹시 떠 있던 이전 이름변경 요청이 있었다면 무효화
      setRenamingId(null)
      return
    }
    const generation = ++songsFetchGenerationRef.current
    try {
      const updated = await renameSong(id, { title })
      if (generation !== songsFetchGenerationRef.current) return
      // songsRef도 setSongs와 같은 자리에서 같이 갱신(위 fetchSongs 코멘트의
      // 불변식 — 미러가 항상 최신이어야 함).
      const next = (songsRef.current ?? []).map((s) => (s.id === id ? updated : s))
      songsRef.current = next
      setSongs(next)
    } catch (err) {
      if (generation !== songsFetchGenerationRef.current) return
      setError(err instanceof ApiError ? err.message : '이름 변경에 실패했습니다')
    } finally {
      setRenamingId(null)
    }
  }

  async function handleDelete(song: SongSummary) {
    if (!window.confirm(`"${song.title}"을(를) 삭제할까요?`)) return
    const generation = ++songsFetchGenerationRef.current
    try {
      await deleteSong(song.id)
      if (generation !== songsFetchGenerationRef.current) return
      const next = (songsRef.current ?? []).filter((s) => s.id !== song.id)
      songsRef.current = next
      setSongs(next)
    } catch (err) {
      if (generation !== songsFetchGenerationRef.current) return
      setError(err instanceof ApiError ? err.message : '삭제에 실패했습니다')
    }
  }

  async function handleLogout() {
    await logout()
    onLoggedOut()
  }

  const visibleSongs = filterSongs(songs ?? [], query)

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
        onSongCreated={() => void silentReload()}
        onPlaySong={onOpenSong}
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
          {(songs ?? []).length === 0 ? '아직 업로드한 곡이 없습니다.' : '검색 결과가 없습니다.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {visibleSongs.map((song) => {
          const isReady = song.status === 'completed'
          const isRenaming = renamingId === song.id
          // 2026-10-26 의뢰인 요청 — 카드 빈 곳을 눌러도 연주 화면으로 이동(지금까지는
          // 제목 글자만 버튼이었음). 처리가 안 끝났거나(열 게 없음) 이름을 바꾸는
          // 중이거나(입력창 클릭이 이동으로 오인되면 안 됨) 이미 여는 중이면 비활성.
          // 모드A 지적(필수, 반영) — 처음엔 카드 자체를 role="button"으로 만들어
          // 키보드로도 빈 곳까지 다 누를 수 있게 했는데, 그 안에 실제 <button>
          // (편집/이름변경/삭제)이 중첩돼 ARIA button 역할의 "자식에 포커스
          // 가능한 요소가 없어야 한다"는 전제를 깨고 있었음(스크린리더가 중첩
          // 버튼을 무시하거나 혼란스럽게 읽을 수 있음) — 카드 자체에서
          // role/tabIndex/onKeyDown을 빼고, 제목을 다시 독립된 <button>으로
          // 되돌려 키보드 접근은 그쪽이 맡는다. 카드의 onClick(마우스 전용,
          // 시맨틱 없음)은 "빈 영역 클릭"만 담당.
          const clickable = isReady && !isRenaming && openingId !== song.id
          return (
            <div
              key={song.id}
              className={clickable ? 'song-card song-card--clickable' : 'song-card'}
              onClick={clickable ? () => void handleOpen(song) : undefined}
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
                      if (e.key === 'Enter') void commitRename(song.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- 인라인 이름변경 진입 시 바로 타이핑
                    autoFocus
                  />
                ) : isReady ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleOpen(song)
                    }}
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
                ) : (
                  // 처리가 아직 안 끝난 곡은 눌러도 열 게 없으므로(DrumScore가
                  // 없음) 버튼이 아니라 그냥 글자로 — 실수로 눌러도 에러가 안 남.
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
              {/* 카드 빈 곳 전체가 클릭 영역이라, 여기 버튼들의 클릭은 카드로
               * 안 퍼지게(stopPropagation) 막아야 "편집" 등을 눌렀는데 동시에
               * 연주 화면으로도 넘어가는 일이 없다(카드 자체엔 키보드 핸들러가
               * 없어 키 입력은 막을 필요 없음 — 위 코멘트 참고). */}
              <div style={{ display: 'flex', gap: 'var(--space-1)' }} onClick={(e) => e.stopPropagation()}>
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
