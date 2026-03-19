'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'

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

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
}

function PriceBlock({ price }: { price: number }) {
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">구매가</p>
      <div className="mt-1 flex items-end gap-1.5">
        <span className="text-2xl font-bold leading-none text-slate-900">{formatCredits(price)}</span>
        <span className="text-xs font-medium text-slate-500">크레딧</span>
      </div>
    </div>
  )
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
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [pendingPurchaseKind, setPendingPurchaseKind] = useState<'pdf' | 'hwp' | null>(null)
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

  const fetchBalance = async () => {
    const res = await fetch('/api/credits/balance', {
      cache: 'no-store',
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error('잔액 정보를 불러오지 못했습니다.')
    }

    const data = await res.json()
    if (typeof data.balance === 'number') {
      setCurrentBalance(data.balance)
      window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: data.balance } }))
    } else {
      throw new Error('잔액 정보 형식이 올바르지 않습니다.')
    }
  }

  const openPurchaseConfirmation = async (assetKind: 'pdf' | 'hwp') => {
    setPendingPurchaseKind(assetKind)
    setIsCheckingBalance(true)
    try {
      await fetchBalance()
      setShowConfirmation(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '크레딧 확인에 실패했습니다.')
      setPendingPurchaseKind(null)
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const handleConfirmPurchase = () => {
    if (!pendingPurchaseKind) {
      return
    }

    setShowConfirmation(false)
    startTransition(async () => {
      try {
        const response = await fetch(`/api/market/items/${itemId}/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetKind: pendingPurchaseKind }),
        })
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || '구매 처리에 실패했습니다.')
        }

        if (typeof payload.balance === 'number') {
          setCurrentBalance(payload.balance)
          window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: payload.balance } }))
        }

        toast.success(payload.message || `${pendingPurchaseKind.toUpperCase()} 구매가 완료되었습니다.`)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '구매 처리 중 오류가 발생했습니다.')
      } finally {
        setPendingPurchaseKind(null)
      }
    })
  }

  const requiredCredits = pendingPurchaseKind === 'pdf'
    ? pdfPrice
    : pendingPurchaseKind === 'hwp'
      ? hwpPrice
      : 0

  const confirmationDescription = pendingPurchaseKind === 'pdf'
    ? 'PDF 파일을 크레딧으로 구매합니다.'
    : pendingPurchaseKind === 'hwp'
      ? 'HWP 파일을 크레딧으로 구매합니다.'
      : '문제마켓 자료를 크레딧으로 구매합니다.'

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
            {hasPdf ? (
              <PriceBlock price={pdfPrice} />
            ) : (
              <p className="mt-2 text-lg font-semibold text-gray-900">미제공</p>
            )}
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
            disabled={!hasPdf || isPending || isCheckingBalance}
            onClick={() => void openPurchaseConfirmation('pdf')}
          >
            {pendingPurchaseKind === 'pdf' && isPending
              ? '구매 처리 중...'
              : isCheckingBalance && pendingPurchaseKind === 'pdf'
                ? '잔액 확인 중...'
                : hasPdf
                  ? 'PDF 구매하기'
                  : 'PDF 없음'}
          </Button>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">HWP</p>
            {hasHwp ? (
              <PriceBlock price={hwpPrice} />
            ) : (
              <p className="mt-2 text-lg font-semibold text-gray-900">미제공</p>
            )}
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
            disabled={!hasHwp || isPending || isCheckingBalance}
            onClick={() => void openPurchaseConfirmation('hwp')}
          >
            {pendingPurchaseKind === 'hwp' && isPending
              ? '구매 처리 중...'
              : isCheckingBalance && pendingPurchaseKind === 'hwp'
                ? '잔액 확인 중...'
                : hasHwp
                  ? 'HWP 구매하기'
                  : 'HWP 없음'}
          </Button>
        )}
      </div>

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => {
          if (isPending) return
          setShowConfirmation(false)
          setPendingPurchaseKind(null)
        }}
        onConfirm={handleConfirmPurchase}
        requiredAmount={requiredCredits}
        currentBalance={currentBalance}
        isLoading={isPending || isCheckingBalance}
        title="문제마켓 구매 확인"
        description={confirmationDescription}
      />
    </div>
  )
}
