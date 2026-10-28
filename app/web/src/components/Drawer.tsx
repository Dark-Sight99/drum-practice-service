import { useEffect } from 'react'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** 슬라이드로 나타날 방향 — 기본 오른쪽. 2026-10-28(의뢰인 요청) — 연습
   * 화면 설정 패널은 화면 왼쪽에 둔다는 지시에 맞춰 'left'로 사용. */
  side?: 'left' | 'right'
}

/** 2026-10-28(의뢰인 요청) — 화면 가장자리에서 슬라이드로 나타나는 설정 패널
 * (어두운 배경 오버레이 동반). `Modal.tsx`(가운데 뜨는 다이얼로그)와 거의 같은
 * 동작 규칙을 그대로 따른다 — 배경 클릭·Esc로 닫힘, 콘텐츠 클릭은 전파 안 됨.
 * 다른 점은 위치(화면 왼쪽/오른쪽 전체 높이)와 애니메이션(슬라이드)뿐이라
 * Modal을 복사해 최소한만 바꿈(공용 로직을 더 추상화하기엔 지금 쓰는 곳이
 * 이거 하나뿐이라 과한 설계 — CLAUDE.md 원칙 6). 연습 화면의 BPM·오디오 지연
 * 보정·믹서·보이는 마디 수처럼 "한 번 맞춰두고 계속 쓰는" 설정들을 한 곳에
 * 모으기 위해 도입(그 전엔 화면 곳곳에 흩어져 있었음) — 넓은 화면에서는 같은
 * 설정 묶음을 Drawer 없이 사이드바로 항상 펼쳐두고, 좁은 화면에서만 이
 * Drawer로 접는다(PracticeCanvas.tsx의 useNarrowSettingsLayout). */
export function Drawer({ open, onClose, title, children, side = 'right' }: DrawerProps) {
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
        zIndex: 100,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'absolute',
          top: 0,
          [side]: 0,
          height: '100%',
          width: 340,
          maxWidth: '90vw',
          background: 'var(--surface)',
          [side === 'left' ? 'borderRight' : 'borderLeft']: '1px solid var(--border)',
          padding: 'var(--space-6)',
          overflowY: 'auto',
          color: 'var(--text)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {title && <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{title}</h2>}
          <button type="button" onClick={onClose} aria-label="설정 닫기" title="설정 닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
