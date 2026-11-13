'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

// 상품을 지운 뒤 Storage 파일 삭제가 실패해 남은 파일이 있을 때만 보이는 안내.
export function StorageCleanupNotice({ pendingCount }: { pendingCount: number }) {
  const router = useRouter()
  const [isRunning, setIsRunning] = useState(false)

  if (pendingCount <= 0) {
    return null
  }

  const handleRetry = async () => {
    setIsRunning(true)
    try {
      const response = await fetch('/api/admin/market/storage-cleanup', { method: 'POST' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '파일 정리에 실패했습니다.')
      }

      const { cleaned, remaining } = payload.data as { cleaned: number; remaining: number }
      if (remaining > 0) {
        toast.error(`파일 ${cleaned}개를 정리했고, ${remaining}개는 아직 남아 있습니다. 다시 눌러도 남으면 개발 담당자에게 확인을 요청해 주세요.`)
      } else {
        toast.success(`남아 있던 파일 ${cleaned}개를 모두 정리했습니다.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 정리 중 오류가 발생했습니다.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p>삭제한 상품의 파일 {pendingCount}개가 아직 저장소에 남아 있습니다. 상품은 정상적으로 삭제됐고, 파일만 정리되지 않았습니다.</p>
      <Button type="button" variant="outline" size="sm" onClick={handleRetry} disabled={isRunning}>
        {isRunning ? '정리하는 중…' : '남은 파일 다시 정리'}
      </Button>
    </div>
  )
}
