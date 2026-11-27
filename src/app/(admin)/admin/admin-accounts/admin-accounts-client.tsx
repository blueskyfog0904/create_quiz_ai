'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { ADMIN_PASSWORD_MIN_LENGTH } from '@/lib/admin-accounts-shared'
import { AdminPermissionsDialog, type AdminPermissionPreset } from './admin-permissions-dialog'

interface AdminAccountRow {
  userId: string
  loginId: string
  createdAt: string | null
  lastSignInAt: string | null
  isBootstrapAccount: boolean
  role: 'owner' | 'staff'
  grants: Array<{ permission: string; limits: unknown }>
}

// 표 안 위험 동작(권한 해제·삭제) 버튼: 보라 테두리 대신 빨강 글자·테두리
const TABLE_DANGER_BUTTON_CLASS = 'border-[var(--admin-tone-danger-border)] text-[var(--admin-tone-danger-text)] hover:bg-[var(--admin-tone-danger-soft)]'

// 날짜 표기는 지금 모양(YYYY.MM.DD) 그대로(20번: 대표가 바꾸기로 정하기 전까지).
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
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  // 비밀번호 재설정은 작은 창에서 새 비밀번호를 두 번 입력해 오타로 계정이 잠기지 않게 한다.
  const [passwordTarget, setPasswordTarget] = useState<AdminAccountRow | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [presets, setPresets] = useState<AdminPermissionPreset[]>([])
  const [editingAccount, setEditingAccount] = useState<AdminAccountRow | null>(null)
  // 브라우저 알림 창 대신 화면 안에 보이는 오류(20번 Q3): 목록 읽기·새 계정·줄 작업(삭제·권한 해제)·비밀번호 창
  const [loadError, setLoadError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const { ask, dialog: confirmDialog } = useAdminConfirm()

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
      setPresets(Array.isArray(result.presets) ? result.presets : [])
      setLoadError(null)
      setActionError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '관리자 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const createAccount = async () => {
    const loginId = newLoginId.trim()
    setCreateError(null)
    if (!loginId || !newPassword) {
      setCreateError('아이디와 비밀번호를 모두 입력하세요.')
      return
    }
    if (newPassword !== newPasswordConfirm) {
      setCreateError('비밀번호 확인이 일치하지 않습니다.')
      return
    }
    setSavingId('new')
    try {
      const response = await fetch('/api/admin/admin-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: loginId, password: newPassword }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '관리자 ID 생성에 실패했습니다.')
      }
      setNewLoginId('')
      setNewPassword('')
      setNewPasswordConfirm('')
      await loadAccounts()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : '관리자 ID 생성에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const patchAccount = async (userId: string, payload: { password: string }) => {
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
      closePasswordDialog()
      toast.success('비밀번호를 변경했습니다.')
      await loadAccounts()
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : '저장에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const deleteAccount = async (account: AdminAccountRow) => {
    // 먼저 묻기(20번 5-3 유형 가): 확인 전에는 요청을 보내지 않는다.
    const confirmed = await ask({
      title: `'${account.loginId}' 관리자 계정을 삭제할까요?`,
      description: '삭제하면 되돌릴 수 없습니다.',
      confirmLabel: '삭제',
      danger: true,
    })
    if (!confirmed) {
      return
    }
    setActionError(null)
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
      setActionError(error instanceof Error ? error.message : '삭제에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  // 일반 관리자의 관리자 자격 해제(W4-6). 계정과 이력은 남고, 관리자 목록에서 빠진다.
  const revokeAccount = async (account: AdminAccountRow) => {
    // 먼저 묻기(20번 5-3 유형 가): 확인 전에는 요청을 보내지 않는다.
    const confirmed = await ask({
      title: `'${account.loginId}' 계정의 관리자 권한을 해제할까요?`,
      description: '해제하면 관리자 화면에 들어올 수 없고 목록에서 빠집니다. 다시 주는 화면은 없습니다(필요하면 새 아이디를 만드세요).',
      confirmLabel: '권한 해제',
      danger: true,
    })
    if (!confirmed) {
      return
    }
    setActionError(null)
    setSavingId(account.userId)
    try {
      const response = await fetch(`/api/admin/admin-accounts/${account.userId}/revoke`, { method: 'POST' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '권한 해제에 실패했습니다.')
      }
      await loadAccounts()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '권한 해제에 실패했습니다.')
    } finally {
      setSavingId(null)
    }
  }

  const openPasswordDialog = (account: AdminAccountRow) => {
    setPasswordTarget(account)
    setResetPasswordValue('')
    setResetPasswordConfirm('')
    setPasswordError(null)
  }

  function closePasswordDialog() {
    setPasswordTarget(null)
    setResetPasswordValue('')
    setResetPasswordConfirm('')
    setPasswordError(null)
  }

  const resetPassword = () => {
    if (!passwordTarget) return
    setPasswordError(null)
    if (resetPasswordValue.length < ADMIN_PASSWORD_MIN_LENGTH) {
      setPasswordError(`비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)
      return
    }
    if (resetPasswordValue !== resetPasswordConfirm) {
      setPasswordError('비밀번호 확인이 일치하지 않습니다.')
      return
    }
    void patchAccount(passwordTarget.userId, { password: resetPasswordValue })
  }

  const columns: AdminDataTableColumn<AdminAccountRow>[] = [
    {
      key: 'loginId',
      header: '아이디',
      cell: (account) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{account.loginId}</span>
          {account.userId === selfUserId ? <AdminStatusBadge label="내 계정" tone="info" /> : null}
        </div>
      ),
    },
    {
      key: 'type',
      header: '유형',
      headerClassName: 'w-28',
      cell: (account) => (
        <AdminStatusBadge label={account.isBootstrapAccount ? '기존 계정' : '관리자 ID'} tone={account.isBootstrapAccount ? 'neutral' : 'success'} />
      ),
    },
    {
      key: 'role',
      header: '역할 · 권한',
      headerClassName: 'w-32',
      cell: (account) => (account.role === 'owner' ? (
        <AdminStatusBadge label="대표 · 모든 권한" tone="warning" />
      ) : (
        <AdminStatusBadge label={`일반 · 권한 ${account.grants.length}개`} tone="neutral" />
      )),
    },
    { key: 'createdAt', header: '생성일', headerClassName: 'w-28', className: 'text-[var(--studio-muted)]', cell: (account) => formatDate(account.createdAt) },
    { key: 'lastSignInAt', header: '최근 로그인', headerClassName: 'w-28', className: 'text-[var(--studio-muted)]', cell: (account) => formatDate(account.lastSignInAt) },
    {
      key: 'actions',
      header: '작업',
      headerClassName: 'w-[26rem]',
      cell: (account) => {
        const isSelf = account.userId === selfUserId
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="adminTable"
              disabled={savingId === account.userId}
              onClick={() => openPasswordDialog(account)}
            >
              비밀번호 재설정
            </Button>
            {account.role === 'staff' && !isSelf ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="adminTable"
                  disabled={savingId === account.userId}
                  onClick={() => setEditingAccount(account)}
                >
                  권한 편집
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="adminTable"
                  className={TABLE_DANGER_BUTTON_CLASS}
                  disabled={savingId === account.userId}
                  onClick={() => void revokeAccount(account)}
                >
                  권한 해제
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="adminTable"
              className={TABLE_DANGER_BUTTON_CLASS}
              disabled={savingId === account.userId || isSelf}
              onClick={() => void deleteAccount(account)}
            >
              삭제
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--studio-ink)]">새 관리자 ID 추가</h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={newLoginId}
            onChange={(event) => setNewLoginId(event.target.value)}
            placeholder="아이디 (영문 소문자·숫자·-·_ 3~30자)"
            className="w-72 max-w-full"
            autoComplete="off"
          />
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder={`비밀번호 (${ADMIN_PASSWORD_MIN_LENGTH}자 이상)`}
            className="w-56 max-w-full"
            autoComplete="new-password"
          />
          <Input
            type="password"
            value={newPasswordConfirm}
            onChange={(event) => setNewPasswordConfirm(event.target.value)}
            placeholder="비밀번호 확인"
            className="w-56 max-w-full"
            autoComplete="new-password"
            aria-invalid={newPasswordConfirm.length > 0 && newPasswordConfirm !== newPassword}
          />
          <Button type="button" variant="brand" disabled={savingId === 'new'} onClick={() => void createAccount()}>
            {savingId === 'new' ? '추가 중…' : '관리자 ID 추가'}
          </Button>
        </div>
        {createError ? <AdminNotice kind="error" className="mt-3">{createError}</AdminNotice> : null}
      </section>

      <p className="text-sm text-[var(--studio-muted)]">
        대표 관리자는 모든 권한을 가지며 권한 편집 대상이 아닙니다. 일반 관리자의 권한을 바꾸면 그 계정의 다음 요청부터 반영됩니다.
      </p>

      {loadError && accounts.length > 0 ? (
        <AdminNotice kind="error" onRetry={() => void loadAccounts()}>{loadError}</AdminNotice>
      ) : null}
      {actionError ? <AdminNotice kind="error">{actionError}</AdminNotice> : null}

      <AdminDataTable
        caption="관리자 ID 목록"
        columns={columns}
        rows={accounts}
        getRowKey={(account) => account.userId}
        minWidth={960}
        state={isLoading ? (
          <AdminTableState kind="loading" message="불러오는 중…" />
        ) : loadError && accounts.length === 0 ? (
          <AdminTableState kind="error" message={loadError} onRetry={() => void loadAccounts()} />
        ) : accounts.length === 0 ? (
          <AdminTableState kind="empty" message="등록된 관리자가 없습니다." />
        ) : undefined}
      />

      {editingAccount && (
        <AdminPermissionsDialog
          account={editingAccount}
          presets={presets}
          onClose={() => setEditingAccount(null)}
          onSaved={() => {
            setEditingAccount(null)
            void loadAccounts()
          }}
        />
      )}

      <Dialog open={passwordTarget !== null} onOpenChange={(open) => { if (!open && savingId !== passwordTarget?.userId) closePasswordDialog() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>비밀번호 재설정</DialogTitle>
            <DialogDescription>
              &apos;{passwordTarget?.loginId}&apos; 계정의 비밀번호를 바꿉니다. 바꾸면 그 계정은 새 비밀번호로만 로그인할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              value={resetPasswordValue}
              onChange={(event) => setResetPasswordValue(event.target.value)}
              placeholder={`새 비밀번호 (${ADMIN_PASSWORD_MIN_LENGTH}자 이상)`}
              autoComplete="new-password"
            />
            <Input
              type="password"
              value={resetPasswordConfirm}
              onChange={(event) => setResetPasswordConfirm(event.target.value)}
              placeholder="새 비밀번호 확인"
              autoComplete="new-password"
              aria-invalid={resetPasswordConfirm.length > 0 && resetPasswordConfirm !== resetPasswordValue}
            />
            {resetPasswordConfirm.length > 0 && resetPasswordConfirm !== resetPasswordValue ? (
              <p className={`text-sm ${ADMIN_TONE_TEXT_CLASSES.danger}`}>비밀번호 확인이 일치하지 않습니다.</p>
            ) : null}
            {passwordError ? <AdminNotice kind="error">{passwordError}</AdminNotice> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="brandOutline" disabled={savingId === passwordTarget?.userId} onClick={closePasswordDialog}>
              취소
            </Button>
            <Button
              type="button"
              variant="brand"
              disabled={
                savingId === passwordTarget?.userId
                || resetPasswordValue.length < ADMIN_PASSWORD_MIN_LENGTH
                || resetPasswordValue !== resetPasswordConfirm
              }
              onClick={resetPassword}
            >
              {savingId === passwordTarget?.userId ? '변경 중…' : '비밀번호 재설정'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  )
}
