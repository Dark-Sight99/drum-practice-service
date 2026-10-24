// 로그인/로그아웃/현재 사용자. 백엔드: app/server/api/auth.py.

import { apiFetch, apiFetchJson } from './client'

export interface CurrentUser {
  id: number
  username: string
  is_admin: boolean
}

export async function login(username: string, password: string): Promise<CurrentUser> {
  return apiFetchJson<CurrentUser>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' })
}

/** 로그인 안 돼 있으면 null(401을 에러로 던지지 않고 "로그인 안 됨"으로 다룸 —
 * 앱 마운트 시 초기 화면을 고르는 용도라 예외보다 값이 다루기 쉬움). */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me', { credentials: 'include' })
  if (response.status === 401) return null
  if (!response.ok) throw new Error(`로그인 상태 확인 실패 (${response.status})`)
  return (await response.json()) as CurrentUser
}
