import { useEffect, useRef } from 'react'

export interface ToastProps {
  message: string
  onDismiss: () => void
  durationMs?: number
}

// 2026-10-26 의뢰인 요청 — 업로드 완료를 모달 안 버튼 문구만이 아니라
// 화면 전체에 토스트/스낵바로도 알려준다. role="status"(암묵적
// aria-live="polite")라 포커스를 뺏지 않고 스크린리더에도 읽힌다.
export function Toast({ message, onDismiss, durationMs = 3000 }: ToastProps) {
  // 모드A 지적(반영) — onDismiss가 매 렌더마다 새로 만들어지는 인라인
  // 함수라서(예: LibraryScreen의 reload()가 끝나 리렌더되는 경우) 그걸 그대로
  // deps에 넣으면 보여주는 도중에 타이머가 계속 재시작돼 실제로는 지정한
  // durationMs보다 더 오래 떠 있을 수 있었다 — ref로 최신 콜백만 들고 있고,
  // 타이머 자체는 durationMs(기본값이라 사실상 고정)에만 묶는다.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  })

  useEffect(() => {
    const id = setTimeout(() => onDismissRef.current(), durationMs)
    return () => clearTimeout(id)
  }, [durationMs])

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
