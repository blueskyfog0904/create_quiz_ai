'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ADMIN_PASSWORD_MIN_LENGTH } from '@/lib/admin-accounts-shared'

export function MyPasswordClient() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  const submit = async () => {
    if (newPassword.length < ADMIN_PASSWORD_MIN_LENGTH) {
      setMessage({ tone: 'error', text: `새 비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` })
      return
    }
    if (newPassword !== confirmPassword) {
      setMessage({ tone: 'error', text: '새 비밀번호 확인이 맞지 않습니다.' })
      return
    }
    setIsSaving(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/my-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '비밀번호를 변경하지 못했습니다.')
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage({
        tone: 'success',
        text: result.otherSessionsSignedOut
          ? '비밀번호를 변경했습니다. 이 화면은 그대로이고, 다른 기기·브라우저의 로그인은 끊었습니다.'
          : '비밀번호를 변경했습니다. 다른 기기·브라우저의 로그인은 끊지 못했습니다 — 그쪽에서 직접 로그아웃해 주세요.',
      })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : '비밀번호를 변경하지 못했습니다.' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">현재 비밀번호</span>
        <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">새 비밀번호 ({ADMIN_PASSWORD_MIN_LENGTH}자 이상, 72바이트 이하)</span>
        <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">새 비밀번호 확인</span>
        <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required />
      </label>
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>
          {message.text}
        </p>
      )}
      <Button type="submit" disabled={isSaving || !currentPassword || !newPassword || !confirmPassword}>
        {isSaving ? '변경 중…' : '비밀번호 변경'}
      </Button>
    </form>
  )
}
