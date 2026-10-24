import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the login screen when not logged in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    render(<App />)
    await waitFor(() => expect(screen.getByText('드럼 연습 서비스')).toBeInTheDocument())
    expect(screen.getByLabelText('아이디')).toBeInTheDocument()
  })

  it('falls back to the login screen when the auth check fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))
    render(<App />)
    await waitFor(() => expect(screen.getByText('드럼 연습 서비스')).toBeInTheDocument())
  })
})
