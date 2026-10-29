import { useEffect, useRef, useState } from 'react'
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  type AdminUser,
} from '../../api/admin'
import { ApiError } from '../../api/client'
import { Modal } from '../../components/Modal'
import { Toast } from '../../components/Toast'
import { Spinner } from '../../components/Spinner'

export interface AdminScreenProps {
  currentUserId: number
  onBack: () => void
}

// 2026-10-29(의뢰인 요청) — "계정 생성 기능도 있었으면 하는데 아이디비번찾기랑".
// REQ-08 결정(가입 화면 없음, 관리자가 직접 생성·정지, intent/02-requirements.md)은
// 그대로 두고 — 관리자가 그 작업을 할 수 있는 화면만 새로 만든다. "비번 찾기"는
// 의뢰인 확인대로 이메일 발송 없이 "관리자가 직접 재설정"으로(아래 비밀번호
// 재설정 모달) — 이 목록 자체가 "아이디 찾기"도 겸한다(관리자가 계정 목록을
// 보고 아이디를 바로 확인 가능).
export function AdminScreen({ currentUserId, onBack }: AdminScreenProps) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Codex 모드A 지적(권장, 반영) — id 하나만 들고 있으면, 다른 행을 누르는
  // 순간 그 전 행이 아직 요청 중인데도 버튼이 다시 활성화돼 중복 요청이
  // 가능했다. Set으로 바꿔 행마다 독립적으로 진행 상태를 추적한다.
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set())

  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)
  const toastIdRef = useRef(0)

  // Codex 모드A 2차 지적(권장, 반영) — 계정 생성·정지·재설정이 거의 동시에
  // 일어나면 각자 끝에서 reload()를 부르는데, 응답이 시작 순서와 다르게
  // 도착하면 더 오래된 조회가 나중에 와서 최신 상태를 덮어쓸 수 있었다
  // (LibraryScreen.tsx의 songsFetchGenerationRef와 같은 패턴 — 이 화면은
  // 곡별 로컬 병합까지는 필요 없어 generation 번호만으로 충분).
  const reloadGenerationRef = useRef(0)

  async function reload() {
    const generation = ++reloadGenerationRef.current
    try {
      const list = await listUsers()
      if (generation !== reloadGenerationRef.current) return
      setUsers(list)
      setError(null)
    } catch (err) {
      if (generation !== reloadGenerationRef.current) return
      setError(err instanceof ApiError ? err.message : '계정 목록을 불러오지 못했습니다')
    }
  }

  useEffect(() => {
    // LibraryScreen.tsx와 같은 이유(마운트 시 서버 데이터 페칭 — oxlint
    // react/set-state-in-effect의 오탐) — 옮길 이벤트 핸들러가 없음.
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [])

  function showToast(message: string) {
    toastIdRef.current += 1
    setToast({ id: toastIdRef.current, message })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await createUser(newUsername, newPassword, newIsAdmin)
      setNewUsername('')
      setNewPassword('')
      setNewIsAdmin(false)
      showToast('✓ 계정이 생성되었습니다')
      await reload()
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : '계정 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleActive(user: AdminUser) {
    setTogglingIds((prev) => new Set(prev).add(user.id))
    try {
      await setUserActive(user.id, !user.is_active)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '상태 변경에 실패했습니다')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(user.id)
        return next
      })
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!resetTarget) return
    setResetSubmitting(true)
    setResetError(null)
    try {
      await resetUserPassword(resetTarget.id, resetPassword)
      showToast(`✓ ${resetTarget.username}의 비밀번호를 재설정했습니다`)
      setResetTarget(null)
      setResetPassword('')
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : '비밀번호 재설정에 실패했습니다')
    } finally {
      setResetSubmitting(false)
    }
  }

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
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>계정 관리</h1>
        <button onClick={onBack}>← 라이브러리</button>
      </div>

      <form
        onSubmit={(e) => void handleCreate(e)}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 'var(--space-2)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-control)',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }} htmlFor="admin-new-username">
            아이디
          </label>
          <input
            id="admin-new-username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            required
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }} htmlFor="admin-new-password">
            비밀번호
          </label>
          <input
            id="admin-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={newIsAdmin}
            onChange={(e) => setNewIsAdmin(e.target.checked)}
          />
          관리자
        </label>
        <button type="submit" disabled={creating}>
          {creating ? <Spinner size={14} /> : '+ 계정 만들기'}
        </button>
        {createError && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13, width: '100%' }}>
            {createError}
          </p>
        )}
      </form>

      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {users === null && error === null && (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중…</p>
      )}

      {users !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--space-2)',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-control)',
                padding: 'var(--space-3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <strong>{u.username}</strong>
                {u.is_admin && (
                  <span style={{ fontSize: 11, color: 'var(--accent)' }}>관리자</span>
                )}
                {!u.is_active && (
                  <span style={{ fontSize: 11, color: 'var(--danger)' }}>정지됨</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  onClick={() => {
                    setResetTarget(u)
                    setResetPassword('')
                    setResetError(null)
                  }}
                >
                  비밀번호 재설정
                </button>
                <button
                  onClick={() => void handleToggleActive(u)}
                  disabled={togglingIds.has(u.id) || u.id === currentUserId}
                  title={u.id === currentUserId ? '본인 계정은 여기서 정지할 수 없습니다' : undefined}
                >
                  {togglingIds.has(u.id) ? (
                    <Spinner size={14} />
                  ) : u.is_active ? (
                    '정지'
                  ) : (
                    '정지 해제'
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title={resetTarget ? `${resetTarget.username}의 비밀번호 재설정` : undefined}
      >
        <form
          onSubmit={(e) => void handleResetPassword(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 260 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }} htmlFor="admin-reset-password">
              새 비밀번호
            </label>
            <input
              id="admin-reset-password"
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              required
              autoFocus
            />
          </div>
          {resetError && (
            <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>
              {resetError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setResetTarget(null)}>
              취소
            </button>
            <button type="submit" disabled={resetSubmitting}>
              {resetSubmitting ? <Spinner size={14} /> : '재설정'}
            </button>
          </div>
        </form>
      </Modal>

      {toast && <Toast key={toast.id} message={toast.message} onDismiss={() => setToast(null)} />}
    </main>
  )
}
