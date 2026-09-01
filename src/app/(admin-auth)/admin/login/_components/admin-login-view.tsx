'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resolveAdminLoginEmail } from '@/lib/admin-accounts-shared'

const controlClassName =
  'min-h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

export function AdminLoginView() {
  const searchParams = useSearchParams()
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(
    searchParams.get('error') === 'forbidden' ? '관리자 계정이 아닙니다.' : null
  )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!loginId.trim() || !password) {
      setError('아이디와 비밀번호를 입력해주세요.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    const supabase = createClient()
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: resolveAdminLoginEmail(loginId),
        password,
      })
      if (signInError) {
        setError('아이디 또는 비밀번호가 올바르지 않습니다.')
        return
      }

      let isAdmin = false
      try {
        const response = await fetch('/api/admin/session')
        const result = await response.json().catch(() => null)
        isAdmin = Boolean(response.ok && result?.isAdmin)
      } catch {
        isAdmin = false
      }

      if (!isAdmin) {
        // 관리자 확인에 실패하면(비관리자·네트워크 오류 모두) 세션을 남기지 않는다
        await supabase.auth.signOut().catch(() => undefined)
        setError('관리자 계정이 아닙니다.')
        return
      }

      window.location.href = '/admin'
    } catch {
      setError('로그인 처리 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="studio-theme flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-7 shadow-[var(--studio-shadow-card)]">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="h-6 w-6 text-[var(--studio-primary)]" />
          <h1 className="text-xl font-bold text-[var(--studio-ink)]">관리자 로그인</h1>
        </div>
        <p className="mt-2 break-keep text-sm text-[var(--studio-muted)]">
          관리자 패널에서 발급된 관리자 ID로만 로그인할 수 있습니다.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-login-id" className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">
              아이디
            </label>
            <input
              id="admin-login-id"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              autoComplete="username"
              className={controlClassName}
            />
          </div>
          <div>
            <label htmlFor="admin-login-password" className="mb-1.5 block text-sm font-semibold text-[var(--studio-ink)]">
              비밀번호
            </label>
            <input
              id="admin-login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className={controlClassName}
            />
          </div>

          {error ? (
            <p role="alert" className="break-keep text-sm font-medium text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--studio-radius-control)] bg-[var(--studio-primary)] text-sm font-semibold text-white transition-colors hover:bg-[var(--studio-primary-hover)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                로그인 중…
              </>
            ) : (
              '로그인'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
