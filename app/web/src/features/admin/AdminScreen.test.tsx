import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminScreen } from './AdminScreen'
import { ApiError } from '../../api/client'
import type { AdminUser } from '../../api/admin'

const {
  listUsersMock,
  createUserMock,
  setUserActiveMock,
  resetUserPasswordMock,
  updateUserMock,
  deleteUserMock,
} = vi.hoisted(() => ({
  listUsersMock: vi.fn(),
  createUserMock: vi.fn(),
  setUserActiveMock: vi.fn(),
  resetUserPasswordMock: vi.fn(),
  updateUserMock: vi.fn(),
  deleteUserMock: vi.fn(),
}))
vi.mock('../../api/admin', () => ({
  listUsers: listUsersMock,
  createUser: createUserMock,
  setUserActive: setUserActiveMock,
  resetUserPassword: resetUserPasswordMock,
  updateUser: updateUserMock,
  deleteUser: deleteUserMock,
}))

function makeUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return { id: 1, username: '의뢰인', is_admin: true, is_active: true, ...overrides }
}

describe('AdminScreen', () => {
  beforeEach(() => {
    listUsersMock.mockReset()
    createUserMock.mockReset()
    setUserActiveMock.mockReset()
    resetUserPasswordMock.mockReset()
    updateUserMock.mockReset()
    deleteUserMock.mockReset()
  })

  it('계정 목록을 불러와 보여준다(아이디 찾기 겸용)', async () => {
    listUsersMock.mockResolvedValue([
      makeUser({ id: 1, username: '의뢰인', is_admin: true }),
      makeUser({ id: 2, username: '친구1', is_admin: false }),
    ])
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('의뢰인')
    expect(screen.getByText('친구1')).toBeInTheDocument()
    // '관리자' 텍스트는 생성 폼의 체크박스 라벨에도 있어, 뱃지는 해당 행으로
    // 범위를 좁혀 확인한다(모드A 지적 전 회귀로 발견 — getByText가 둘 다
    // 매칭해 실패했었음).
    const ownerRow = screen.getByText('의뢰인').closest('div')!.parentElement!
    expect(within(ownerRow).getByText('관리자')).toBeInTheDocument()
  })

  it('새 계정을 만들면 목록을 다시 불러온다', async () => {
    listUsersMock
      .mockResolvedValueOnce([makeUser({ id: 1, username: '의뢰인' })])
      .mockResolvedValueOnce([
        makeUser({ id: 1, username: '의뢰인' }),
        makeUser({ id: 2, username: '새친구', is_admin: false }),
      ])
    createUserMock.mockResolvedValue(makeUser({ id: 2, username: '새친구', is_admin: false }))
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('의뢰인')
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: '새친구' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw1234' } })
    fireEvent.click(screen.getByRole('button', { name: '+ 계정 만들기' }))

    await screen.findByText('새친구')
    expect(createUserMock).toHaveBeenCalledWith('새친구', 'pw1234', false)
  })

  it('계정 생성 실패 시 에러 문구를 보여준다', async () => {
    listUsersMock.mockResolvedValue([makeUser()])
    createUserMock.mockRejectedValue(new ApiError(409, '이미 있는 아이디입니다'))
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('의뢰인')
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: '중복' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw1234' } })
    fireEvent.click(screen.getByRole('button', { name: '+ 계정 만들기' }))

    await screen.findByText('이미 있는 아이디입니다')
  })

  it('본인 계정은 정지 버튼이 비활성화된다', async () => {
    listUsersMock.mockResolvedValue([
      makeUser({ id: 1, username: '의뢰인' }),
      makeUser({ id: 2, username: '친구1' }),
    ])
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('의뢰인')
    const rows = screen.getAllByRole('button', { name: '정지' })
    // 본인(id=1) 행의 버튼은 비활성화, 다른 사람(id=2) 행은 활성화.
    expect(rows.some((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(rows.some((b) => !(b as HTMLButtonElement).disabled)).toBe(true)
  })

  it('다른 사람 정지 버튼을 누르면 setUserActive를 호출한다', async () => {
    listUsersMock
      .mockResolvedValueOnce([
        makeUser({ id: 1, username: '의뢰인' }),
        makeUser({ id: 2, username: '친구1', is_active: true }),
      ])
      .mockResolvedValueOnce([
        makeUser({ id: 1, username: '의뢰인' }),
        makeUser({ id: 2, username: '친구1', is_active: false }),
      ])
    setUserActiveMock.mockResolvedValue(makeUser({ id: 2, is_active: false }))
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('친구1')
    const buttons = screen.getAllByRole('button', { name: '정지' })
    const friendButton = buttons.find((b) => !(b as HTMLButtonElement).disabled)!
    fireEvent.click(friendButton)

    await waitFor(() => expect(setUserActiveMock).toHaveBeenCalledWith(2, false))
  })

  it('비밀번호 재설정 모달에서 제출하면 resetUserPassword를 호출한다', async () => {
    listUsersMock.mockResolvedValue([makeUser({ id: 2, username: '친구1', is_admin: false })])
    resetUserPasswordMock.mockResolvedValue(undefined)
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('친구1')
    fireEvent.click(screen.getByRole('button', { name: '비밀번호 재설정' }))
    fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'newpw123' } })
    fireEvent.click(screen.getByRole('button', { name: '재설정' }))

    await waitFor(() => expect(resetUserPasswordMock).toHaveBeenCalledWith(2, 'newpw123'))
  })

  it('수정 모달에서 아이디를 바꾸면 updateUser를 호출한다', async () => {
    listUsersMock
      .mockResolvedValueOnce([makeUser({ id: 2, username: '친구1', is_admin: false })])
      .mockResolvedValueOnce([makeUser({ id: 2, username: '바뀐이름', is_admin: false })])
    updateUserMock.mockResolvedValue(makeUser({ id: 2, username: '바뀐이름', is_admin: false }))
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('친구1')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    const editDialog = screen.getByRole('dialog')
    fireEvent.change(within(editDialog).getByLabelText('아이디'), {
      target: { value: '바뀐이름' },
    })
    fireEvent.click(within(editDialog).getByRole('button', { name: '저장' }))

    await waitFor(() =>
      expect(updateUserMock).toHaveBeenCalledWith(2, { username: '바뀐이름' }),
    )
    await screen.findByText('바뀐이름')
  })

  it('본인 행의 수정 모달에서는 관리자 체크박스가 비활성화된다', async () => {
    listUsersMock.mockResolvedValue([makeUser({ id: 1, username: '의뢰인', is_admin: true })])
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('의뢰인')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    const editDialog = screen.getByRole('dialog')
    const checkbox = within(editDialog)
      .getAllByRole('checkbox')
      .find((el) => el.closest('label')?.textContent?.includes('관리자'))
    expect(checkbox).toBeDisabled()
  })

  it('삭제 확인 모달에서 확인하면 deleteUser를 호출한다', async () => {
    listUsersMock
      .mockResolvedValueOnce([makeUser({ id: 2, username: '친구1', is_admin: false })])
      .mockResolvedValueOnce([])
    deleteUserMock.mockResolvedValue(undefined)
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('친구1')
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(deleteUserMock).toHaveBeenCalledWith(2))
  })

  it('본인 행의 삭제·정지 버튼은 비활성화된다', async () => {
    listUsersMock.mockResolvedValue([
      makeUser({ id: 1, username: '의뢰인' }),
      makeUser({ id: 2, username: '친구1' }),
    ])
    render(<AdminScreen currentUserId={1} onBack={() => {}} />)

    await screen.findByText('의뢰인')
    const ownerRow = screen.getByText('의뢰인').closest('div')!.parentElement!
    expect(within(ownerRow).getByRole('button', { name: '삭제' })).toBeDisabled()
    expect(within(ownerRow).getByRole('button', { name: '정지' })).toBeDisabled()
  })
})
