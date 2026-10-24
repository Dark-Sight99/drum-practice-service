import { useState } from 'react'
import { login, type CurrentUser } from '../../api/auth'
import { ApiError } from '../../api/client'

export interface LoginScreenProps {
  onLoggedIn: (user: CurrentUser) => void
}

// REQ-08 "가입 화면 없음 — 관리자가 계정을 직접 생성" — 여기엔 가입 링크가 없다.
// Google 소셜 로그인 전환은 Q-20(intent/07-open-questions.md)으로 별도 작업.
export function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const user = await login(username, password)
      onLoggedIn(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '로그인에 실패했습니다')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          width: 280,
          padding: 'var(--space-6)',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-control)',
        }}
      >
        <h1 style={{ fontSize: '1.2rem', margin: 0 }}>드럼 연습 서비스</h1>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          아이디
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </main>
  )
}
