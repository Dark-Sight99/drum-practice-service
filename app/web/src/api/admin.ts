// 관리자 전용: 계정 생성·목록·정지·비밀번호 재설정. 백엔드: app/server/api/admin.py.
// 근거: REQ-08("가입 화면 없음, 관리자가 계정을 직접 생성·정지") — 2026-10-29
// 의뢰인 요청으로 그 "관리자가 직접" 할 수 있는 화면을 추가.

import { apiFetch, apiFetchJson } from './client'

export interface AdminUser {
  id: number
  username: string
  is_admin: boolean
  is_active: boolean
}

export async function listUsers(): Promise<AdminUser[]> {
  return apiFetchJson<AdminUser[]>('/admin/users')
}

export async function createUser(
  username: string,
  password: string,
  isAdmin: boolean,
): Promise<AdminUser> {
  return apiFetchJson<AdminUser>('/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, is_admin: isAdmin }),
  })
}

export async function setUserActive(userId: number, isActive: boolean): Promise<AdminUser> {
  return apiFetchJson<AdminUser>(`/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  })
}

/** 이메일 발송 없이 관리자가 직접 비밀번호를 재설정(의뢰인 확인, 2026-10-29) —
 * "비번 찾기" 요청에 대한 답. */
export async function resetUserPassword(userId: number, newPassword: string): Promise<void> {
  await apiFetch(`/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  })
}
