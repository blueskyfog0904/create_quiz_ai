'use client'

import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleLogout = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error('로그아웃에 실패했습니다.')
      }

      toast.success('로그아웃되었습니다.')
      // Force full page reload to clear all state
      window.location.href = '/login'
    } catch (error: any) {
      console.error('Logout error:', error)
      toast.error(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={isLoading}
    >
      {isLoading ? '로그아웃 중...' : '로그아웃'}
    </Button>
  )
}

