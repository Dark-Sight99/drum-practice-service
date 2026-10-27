// 로그인/로그아웃/현재 사용자/계정 전체 믹서 설정. 백엔드: app/server/api/auth.py.

import { apiFetch, apiFetchJson } from './client'
import type { MixerState } from '../audio/mixer'

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

/** T3-28(REQ-05, 2026-10-27 의뢰인 요청) — 믹서 설정을 곡별이 아니라 계정
 * 전체로 공유("1번 곡에서 맞춘 믹서값이 2번·3번 곡으로 가도 유지"). 저장된
 * 게 없으면 `volumes: null`(기본값은 호출자가 `defaultMixerState()`로
 * 채움 — 과거 곡별 버전과 같은 원칙). */
export async function fetchMixerSetting(): Promise<{ volumes: MixerState | null }> {
  return apiFetchJson<{ volumes: MixerState | null }>('/auth/me/mixer-setting')
}

/** T3-28(REQ-05) — 계정 전체 믹서 설정 저장. */
export async function saveMixerSetting(volumes: MixerState): Promise<void> {
  await apiFetch('/auth/me/mixer-setting', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volumes }),
  })
}
