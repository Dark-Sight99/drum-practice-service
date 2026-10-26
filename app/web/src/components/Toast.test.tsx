import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('메시지를 보여주고, 지정한 시간이 지나면 onDismiss를 부름', () => {
    const onDismiss = vi.fn()
    render(<Toast message="✓ 업로드가 완료되었습니다" onDismiss={onDismiss} durationMs={1000} />)

    expect(screen.getByRole('status')).toHaveTextContent('✓ 업로드가 완료되었습니다')
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
