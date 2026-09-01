'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AdminAccountRow {
  userId: string
  loginId: string
  name: string | null
  createdAt: string | null
  lastSignInAt: string | null
  isBootstrapAccount: boolean
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

export default function AdminAccountsClient() {
  const [accounts, setAccounts] = useState<AdminAccountRow[]>([])
  const [selfUserId, setSelfUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [newLoginId, setNewLoginId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})

  const loadAccounts = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/admin-accounts')
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '관리자 목록을 불러오지 못했습니다.')
      }
      const rows: AdminAccountRow[] = result.data
      setAccounts(rows)
      setSelfUserId(result.selfUserId ?? null)
      setNameDrafts(Object.fromEntries(rows.map((row) => [row.userId, row.name ?? ''])))
      setPasswordDrafts({})
    } catch (error) {
      alert(error instanceof Error ? error.message : '관리자 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const createAccount = async () => {
    const loginId = newLoginId.trim()
    const name = newName.trim()
    if (!loginId || !name || !newPassword) {
      alert('아이디, 이름, 비밀번호를 모두 입력하세요.')
      return
    }
    setSavingId('new')
    try {
      const response = await fetch('/api/admin/admin-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: loginId, name, password: newPassword }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '관리자 ID 생성에 실패했습니다.')
      }
      setNewLoginId('')
      setNewName('')
      setNewPassword('')
      await loadAccounts()
    } catch (error) {
      alert(error instanceof Error ? error.message : '관리자 ID 생성에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const patchAccount = async (userId: string, payload: { name?: string; password?: string }) => {
    setSavingId(userId)
    try {
      const response = await fetch(`/api/admin/admin-accounts/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '저장에 실패했습니다.')
      }
      if (payload.password !== undefined) {
        setPasswordDrafts((current) => ({ ...current, [userId]: '' }))
        alert('비밀번호를 변경했습니다.')
      }
      await loadAccounts()
    } catch (error) {
      alert(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const deleteAccount = async (account: AdminAccountRow) => {
    if (!confirm(`'${account.loginId}' 관리자 계정을 삭제할까요? 삭제하면 되돌릴 수 없습니다.`)) {
      return
    }
    setSavingId(account.userId)
    try {
      const response = await fetch(`/api/admin/admin-accounts/${account.userId}`, {
        method: 'DELETE',
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '삭제에 실패했습니다.')
      }
      await loadAccounts()
    } catch (error) {
      alert(error instanceof Error ? error.message : '삭제에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const saveName = (account: AdminAccountRow) => {
    const draft = (nameDrafts[account.userId] ?? '').trim()
    if (!draft) {
      alert('이름을 입력하세요.')
      return
    }
    void patchAccount(account.userId, { name: draft })
  }

  const resetPassword = (account: AdminAccountRow) => {
    const draft = passwordDrafts[account.userId] ?? ''
    if (draft.length < 8) {
      alert('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    void patchAccount(account.userId, { password: draft })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">새 관리자 ID 추가</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={newLoginId}
            onChange={(event) => setNewLoginId(event.target.value)}
            placeholder="아이디 (영문 소문자·숫자·-·_ 3~30자)"
            className="w-72"
            autoComplete="off"
          />
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="이름"
            className="w-44"
            autoComplete="off"
          />
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="비밀번호 (8자 이상)"
            className="w-56"
            autoComplete="new-password"
          />
          <Button type="button" disabled={savingId === 'new'} onClick={() => void createAccount()}>
            {savingId === 'new' ? '추가 중…' : '관리자 ID 추가'}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-3 font-medium">아이디</th>
              <th className="w-44 px-4 py-3 font-medium">이름</th>
              <th className="w-28 px-4 py-3 font-medium">유형</th>
              <th className="w-28 px-4 py-3 font-medium">생성일</th>
              <th className="w-28 px-4 py-3 font-medium">최근 로그인</th>
              <th className="w-[26rem] px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">불러오는 중…</td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">등록된 관리자가 없습니다.</td>
              </tr>
            ) : (
              accounts.map((account) => {
                const isSelf = account.userId === selfUserId
                const nameDraft = nameDrafts[account.userId] ?? ''
                const isNameDirty = nameDraft !== (account.name ?? '')
                return (
                  <tr key={account.userId} className="border-b last:border-b-0">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{account.loginId}</span>
                        {isSelf ? (
                          <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">내 계정</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        value={nameDraft}
                        onChange={(event) => setNameDrafts((current) => ({
                          ...current,
                          [account.userId]: event.target.value,
                        }))}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-2 py-1 text-xs font-medium ${account.isBootstrapAccount ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                        {account.isBootstrapAccount ? '기존 계정' : '관리자 ID'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDate(account.createdAt)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{formatDate(account.lastSignInAt)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === account.userId || !isNameDirty}
                          onClick={() => saveName(account)}
                        >
                          이름 저장
                        </Button>
                        <Input
                          type="password"
                          value={passwordDrafts[account.userId] ?? ''}
                          onChange={(event) => setPasswordDrafts((current) => ({
                            ...current,
                            [account.userId]: event.target.value,
                          }))}
                          placeholder="새 비밀번호"
                          className="w-36"
                          autoComplete="new-password"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingId === account.userId || (passwordDrafts[account.userId] ?? '').length < 8}
                          onClick={() => resetPassword(account)}
                        >
                          비밀번호 재설정
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={savingId === account.userId || isSelf}
                          onClick={() => void deleteAccount(account)}
                        >
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
