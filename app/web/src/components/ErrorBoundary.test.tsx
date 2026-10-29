import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom')
  return <div>정상 화면</div>
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('정상일 때는 자식을 그대로 보여준다', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('정상 화면')).toBeInTheDocument()
  })

  it('자식이 렌더링 중 던지면 안내 화면을 보여준다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('문제가 발생했습니다')).toBeInTheDocument()
  })

  it('"다시 시도"를 누르면 자식을 다시 그려보고, 복구됐으면 정상 화면이 보인다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('boom')
      return <div>복구됨</div>
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByText('문제가 발생했습니다')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByText('다시 시도'))

    expect(screen.getByText('복구됨')).toBeInTheDocument()
  })
})
