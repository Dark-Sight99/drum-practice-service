import { useEffect } from 'react'

export interface ToastProps {
  message: string
  onDismiss: () => void
  durationMs?: number
}

// 2026-10-26 의뢰인 요청 — 업로드 완료를 모달 안 버튼 문구만이 아니라
// 화면 전체에 토스트/스낵바로도 알려준다. role="status"(암묵적
// aria-live="polite")라 포커스를 뺏지 않고 스크린리더에도 읽힌다.
export function Toast({ message, onDismiss, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(id)
  }, [onDismiss, durationMs])

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'var(--space-6)',
        transform: 'translateX(-50%)',
        background: 'var(--surface-2)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-control)',
        padding: 'var(--space-3) var(--space-4)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        zIndex: 200,
      }}
    >
      {message}
    </div>
  )
}
