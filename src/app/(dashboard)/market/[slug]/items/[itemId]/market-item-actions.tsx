'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileDown, ShoppingCart, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'

interface MarketItemActionsProps {
  itemId: string
  hasSample: boolean
  hasPdf: boolean
  hasHwp: boolean
  isLoggedIn: boolean
  ownsPdf: boolean
  ownsHwp: boolean
  pdfPrice: number
  hwpPrice: number
}

type PurchaseAssetKind = 'pdf' | 'hwp'
type OptionState = 'instant' | 'owned' | 'available' | 'unavailable' | 'checking' | 'processing'

function buildDownloadUrl(itemId: string, assetKind: 'sample' | 'pdf' | 'hwp') {
  return `/api/market/items/${itemId}/download?assetKind=${assetKind}`
}

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
}

function getPurchaseErrorMessage(status: number, fallback?: string) {
  if (status === 401) {
    return '로그인이 필요합니다. 로그인 후 다시 구매해주세요.'
  }

  if (status === 402) {
    return fallback || '크레딧이 부족합니다. 충전 후 다시 시도해주세요.'
  }

  if (status === 409) {
    return fallback || '이미 구매한 파일입니다. 다운로드 상태를 새로고침합니다.'
  }

  if (status >= 500) {
    return fallback || '서버 오류로 구매에 실패했습니다. 잠시 후 다시 시도해주세요.'
  }

  return fallback || '구매 처리에 실패했습니다.'
}

function OptionStateBadge({ state }: { state: OptionState }) {
  if (state === 'instant') {
    return <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-50">무료</Badge>
  }

  if (state === 'owned') {
    return <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">구매 완료</Badge>
  }

  if (state === 'checking') {
    return <Badge variant="outline">잔액 확인 중</Badge>
  }

  if (state === 'processing') {
    return <Badge variant="outline">구매 처리 중</Badge>
  }

  if (state === 'unavailable') {
    return <Badge variant="outline" className="text-slate-400">미제공</Badge>
  }

  return <Badge variant="outline">미구매</Badge>
}

function FileOptionRow({
  title,
  description,
  priceLabel,
  state,
  icon,
  actionLabel,
  href,
  disabled,
  onAction,
}: {
  title: string
  description: string
  priceLabel: string
  state: OptionState
  icon: ReactNode
  actionLabel: string
  href?: string
  disabled?: boolean
  onAction?: () => void
}) {
  const buttonClassName = state === 'available'
    ? 'bg-rose-600 text-white hover:bg-rose-700'
    : 'bg-secondary text-secondary-foreground hover:bg-secondary/85'

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-950">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        <OptionStateBadge state={state} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">이용가</p>
          <p className="mt-1 text-lg font-bold text-slate-950">{priceLabel}</p>
        </div>
        {href ? (
          <Button asChild className={`h-10 rounded-lg px-4 ${buttonClassName}`} disabled={disabled}>
            <a href={href} aria-label={`${title} ${actionLabel}`}>{actionLabel}</a>
          </Button>
        ) : (
          <Button className={`h-10 rounded-lg px-4 ${buttonClassName}`} disabled={disabled} onClick={onAction} aria-label={`${title} ${actionLabel}`}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

export default function MarketItemActions({
  itemId,
  hasSample,
  hasPdf,
  hasHwp,
  isLoggedIn,
  ownsPdf,
  ownsHwp,
  pdfPrice,
  hwpPrice,
}: MarketItemActionsProps) {
  const router = useRouter()
  const { redirectToLogin } = useLoginRedirect()
  const [isPending, startTransition] = useTransition()
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [pendingPurchaseKind, setPendingPurchaseKind] = useState<PurchaseAssetKind | null>(null)
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

  const openPurchaseConfirmation = async (assetKind: PurchaseAssetKind) => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

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
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || !payload.success) {
          throw new Error(getPurchaseErrorMessage(response.status, payload.error?.message))
        }

        if (typeof payload.balance === 'number') {
          setCurrentBalance(payload.balance)
          window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: payload.balance } }))
        }

        toast.success(payload.message || `${pendingPurchaseKind.toUpperCase()} 구매가 완료되었습니다.`)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '구매 처리 중 오류가 발생했습니다.')
        router.refresh()
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

  const getPaidOptionState = (assetKind: PurchaseAssetKind, owned: boolean, available: boolean): OptionState => {
    if (owned) return 'owned'
    if (!available) return 'unavailable'
    if (pendingPurchaseKind === assetKind && isPending) return 'processing'
    if (pendingPurchaseKind === assetKind && isCheckingBalance) return 'checking'
    return 'available'
  }

  return (
    <div className="space-y-3">
      <FileOptionRow
        title="샘플 PDF"
        description={hasSample ? '구매 전 샘플 파일을 먼저 확인할 수 있습니다.' : '현재 제공되는 샘플 파일이 없습니다.'}
        priceLabel="무료"
        state={hasSample ? 'instant' : 'unavailable'}
        icon={<Sparkles className="h-5 w-5" />}
        actionLabel={hasSample ? '샘플 다운로드' : '샘플 없음'}
        href={hasSample && isLoggedIn ? buildDownloadUrl(itemId, 'sample') : undefined}
        disabled={!hasSample}
        onAction={hasSample && !isLoggedIn ? () => redirectToLogin() : undefined}
      />

      <FileOptionRow
        title="PDF"
        description={ownsPdf ? '구매 완료된 PDF 파일입니다.' : hasPdf ? '구매 후 바로 PDF를 다운로드할 수 있습니다.' : 'PDF 파일이 제공되지 않습니다.'}
        priceLabel={hasPdf ? `${formatCredits(pdfPrice)} 크레딧` : '미제공'}
        state={getPaidOptionState('pdf', ownsPdf, hasPdf)}
        icon={ownsPdf ? <CheckCircle2 className="h-5 w-5" /> : <FileDown className="h-5 w-5" />}
        actionLabel={ownsPdf ? 'PDF 다운로드' : hasPdf ? 'PDF 구매하기' : 'PDF 없음'}
        href={ownsPdf ? buildDownloadUrl(itemId, 'pdf') : undefined}
        disabled={!hasPdf || isPending || isCheckingBalance}
        onAction={!ownsPdf && hasPdf ? () => void openPurchaseConfirmation('pdf') : undefined}
      />

      <FileOptionRow
        title="HWP"
        description={ownsHwp ? '구매 완료된 HWP 파일입니다.' : hasHwp ? '구매 후 바로 HWP를 다운로드할 수 있습니다.' : 'HWP 파일이 제공되지 않습니다.'}
        priceLabel={hasHwp ? `${formatCredits(hwpPrice)} 크레딧` : '미제공'}
        state={getPaidOptionState('hwp', ownsHwp, hasHwp)}
        icon={ownsHwp ? <CheckCircle2 className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
        actionLabel={ownsHwp ? 'HWP 다운로드' : hasHwp ? 'HWP 구매하기' : 'HWP 없음'}
        href={ownsHwp ? buildDownloadUrl(itemId, 'hwp') : undefined}
        disabled={!hasHwp || isPending || isCheckingBalance}
        onAction={!ownsHwp && hasHwp ? () => void openPurchaseConfirmation('hwp') : undefined}
      />

      <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        구매 후 바로 다운로드할 수 있으며, 구매한 파일은 <span className="font-semibold text-slate-700">영어 라이브러리 &gt; 구매자료</span>에서도 확인할 수 있습니다.
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
