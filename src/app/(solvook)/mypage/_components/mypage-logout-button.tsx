'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'

export function MypageLogoutButton() {
  const [isLoading, setIsLoading] = useState(false)

  const handleLogout = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error('로그아웃에 실패했습니다.')
      }
      window.location.href = '/login?logout=success'
    } catch (error) {
      alert(error instanceof Error ? error.message : '로그아웃에 실패했습니다.')
      setIsLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      disabled={isLoading}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm font-medium text-[var(--studio-ink)] transition-colors hover:border-[var(--studio-primary-border)] hover:text-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] disabled:opacity-50"
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
      {isLoading ? '로그아웃 중…' : '로그아웃'}
    </button>
  )
}
