import { useEffect } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
}

/** T3-19(REQ-07, 2026-10-26 의뢰인 요청) — 화면 한가운데에 뜨는 모달/다이얼로그
 * (어두운 배경 오버레이 동반). 지금은 업로드에만 쓰이지만, T5-0(전체 화면 UI
 * 디자인 다듬기)에서 다른 화면에도 재사용할 수 있게 범용으로 둠.
 * - 배경(오버레이) 클릭 시 닫힘(의뢰인 요청 — "잘못 눌렀을 수도 있으니").
 * - Esc 키로도 닫힘(배경 클릭과 같은 취지의 표준 동작, 추가 비용 적어 포함).
 * - 콘텐츠 영역 클릭은 전파를 막지 않고, 오버레이 자신(e.target===e.currentTarget)
 *   클릭일 때만 닫는다 — 콘텐츠 내부 클릭이 배경까지 버블링돼도 안전. */
export function Modal({ open, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 'var(--space-4)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-control)',
          border: '1px solid var(--border)',
          padding: 'var(--space-6)',
          minWidth: 320,
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflowY: 'auto',
          color: 'var(--text)',
        }}
      >
        {title && <h2 style={{ marginTop: 0, fontSize: '1.2rem' }}>{title}</h2>}
        {children}
      </div>
    </div>
  )
}
