'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface MarketItemActionsProps {
  itemId: string
  hasSample: boolean
  hasPdf: boolean
  hasHwp: boolean
  ownsPdf: boolean
  ownsHwp: boolean
  pdfPrice: number
  hwpPrice: number
}

function buildDownloadUrl(itemId: string, assetKind: 'sample' | 'pdf' | 'hwp') {
  return `/api/market/items/${itemId}/download?assetKind=${assetKind}`
}

export default function MarketItemActions({
  itemId,
  hasSample,
  hasPdf,
  hasHwp,
  ownsPdf,
  ownsHwp,
  pdfPrice,
  hwpPrice,
}: MarketItemActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submittingKind, setSubmittingKind] = useState<'pdf' | 'hwp' | null>(null)
  const viewTracked = useRef(false)

  const viewSessionKey = useMemo(() => `market-item:${itemId}`, [itemId])

  useEffect(() => {
    if (viewTracked.current) {
      return
    }

    viewTracked.current = true

    fetch(`/api/market/items/${itemId}/view`, {
      method: 'POST',
      headers: {
        'x-market-session-key': viewSessionKey,
      },
    }).catch(() => undefined)
  }, [itemId, viewSessionKey])

  const handlePurchase = (assetKind: 'pdf' | 'hwp') => {
    setSubmittingKind(assetKind)
    startTransition(async () => {
      try {
        const response = await fetch(`/api/market/items/${itemId}/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetKind }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || '구매 처리에 실패했습니다.')
        }

        toast.success(payload.message || `${assetKind.toUpperCase()} 구매가 완료되었습니다.`)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '구매 처리 중 오류가 발생했습니다.')
      } finally {
        setSubmittingKind(null)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">샘플 파일</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{hasSample ? '무료 제공' : '미제공'}</p>
          </div>
          {hasSample ? <Badge variant="secondary">즉시 다운로드</Badge> : null}
        </div>
        <Button
          asChild={hasSample}
          className="mt-3 w-full"
          variant="outline"
          disabled={!hasSample}
        >
          {hasSample ? <a href={buildDownloadUrl(itemId, 'sample')}>샘플 다운로드</a> : <span>샘플 없음</span>}
        </Button>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">PDF</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{hasPdf ? `${pdfPrice} 크레딧` : '미제공'}</p>
          </div>
          {ownsPdf ? <Badge>구매 완료</Badge> : hasPdf ? <Badge variant="outline">미구매</Badge> : null}
        </div>
        {ownsPdf ? (
          <Button asChild className="mt-3 w-full">
            <a href={buildDownloadUrl(itemId, 'pdf')}>PDF 다시 다운로드</a>
          </Button>
        ) : (
          <Button
            className="mt-3 w-full"
            disabled={!hasPdf || isPending}
            onClick={() => handlePurchase('pdf')}
          >
            {submittingKind === 'pdf' ? '구매 처리 중...' : hasPdf ? 'PDF 구매하기' : 'PDF 없음'}
          </Button>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">HWP</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{hasHwp ? `${hwpPrice} 크레딧` : '미제공'}</p>
          </div>
          {ownsHwp ? <Badge>구매 완료</Badge> : hasHwp ? <Badge variant="outline">미구매</Badge> : null}
        </div>
        {ownsHwp ? (
          <Button asChild className="mt-3 w-full">
            <a href={buildDownloadUrl(itemId, 'hwp')}>HWP 다시 다운로드</a>
          </Button>
        ) : (
          <Button
            className="mt-3 w-full"
            disabled={!hasHwp || isPending}
            onClick={() => handlePurchase('hwp')}
          >
            {submittingKind === 'hwp' ? '구매 처리 중...' : hasHwp ? 'HWP 구매하기' : 'HWP 없음'}
          </Button>
        )}
      </div>
    </div>
  )
}
