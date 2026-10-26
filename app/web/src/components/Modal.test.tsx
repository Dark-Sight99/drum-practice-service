import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>내용</p>
      </Modal>,
    )
    expect(screen.queryByText('내용')).not.toBeInTheDocument()
  })

  it('renders children when open', () => {
    render(
      <Modal open onClose={() => {}}>
        <p>내용</p>
      </Modal>,
    )
    expect(screen.getByText('내용')).toBeInTheDocument()
  })

  it('calls onClose when the backdrop (not the content) is clicked', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <p>내용</p>
      </Modal>,
    )
    // T3-19 — "사용자가 잘못 눌렀을 수도 있으니" 배경 클릭 시 닫혀야 함.
    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onClose when clicking inside the content', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <p>내용</p>
      </Modal>,
    )
    fireEvent.click(screen.getByText('내용'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <p>내용</p>
      </Modal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
