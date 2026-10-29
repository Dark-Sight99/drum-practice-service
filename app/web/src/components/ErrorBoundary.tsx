import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

// 2026-10-29(의뢰인 요청) — 지금까지 앱 전체에 전역 에러 바운더리가 없어
// 렌더링 중 예상 못 한 오류(예: 악보 데이터 이상)가 나면 React가 트리를
// 통째로 떼어내 흰 백지 화면만 남고, 사용자가 할 수 있는 게 전혀 없었다
// (componentDidCatch/ErrorBoundary 검색 결과 0건으로 확인됨). main.tsx에서
// <App />을 이 컴포넌트로 감싸 최후의 안전망으로 둔다.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('전역 에러 바운더리에서 잡힌 오류', error, info.componentStack)
  }

  handleRetry = (): void => {
    // 새로고침 없이 자식 트리를 다시 그려본다 — 렌더링 경로의 일시적 문제라면
    // (예: 특정 상태에서만 터지는 조건) 네트워크 재요청 없이 바로 복구됨.
    this.setState({ hasError: false })
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }
    return (
      <main
        style={{
          background: 'var(--bg)',
          color: 'var(--text)',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 360,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-control)',
            padding: 'var(--space-8) var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-4)',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: '2rem', color: 'var(--danger)' }}>⚠</span>
          <div>
            <h1 style={{ margin: '0 0 6px 0', fontSize: '1.1rem' }}>문제가 발생했습니다</h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              예상치 못한 오류로 화면을 표시할 수 없습니다.
              <br />
              다시 시도하거나 새로고침해주세요.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="button" onClick={this.handleRetry}>
              다시 시도
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              새로고침
            </button>
          </div>
        </div>
      </main>
    )
  }
}
