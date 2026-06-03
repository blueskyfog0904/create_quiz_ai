'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Eye, FileArchive, FileCheck2, FileStack, FileText, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import type { MarketBundlePublicSummary, MarketSubproductDownloadFile, MarketSubproductPublicSummary } from '@/lib/market-items-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import MarketSamplePreviewDialog from './market-sample-preview-dialog'
import MarketPurchaseCompleteDialog from '../../market-purchase-complete-dialog'

interface MarketItemActionsProps {
  itemId: string
  hasSamplePages: boolean
  hasLegacySample: boolean
  hasPdf: boolean
  hasHwp: boolean
  hasZip: boolean
  isLoggedIn: boolean
  ownsPdf: boolean
  ownsHwp: boolean
  ownsZip: boolean
  pdfPrice: number
  hwpPrice: number
  zipPrice: number
  samplePageCount: number
  workspaceSubject: WorkspaceSubject
  subproducts?: MarketSubproductPublicSummary[]
  bundleOption?: MarketBundlePublicSummary | null
  downloadFiles?: MarketSubproductDownloadFile[]
}

type PurchaseAssetKind = 'pdf' | 'hwp' | 'zip'
type OptionState = 'instant' | 'owned' | 'included' | 'available' | 'unavailable' | 'checking' | 'processing'
type V2PurchaseIntent =
  | { purchaseType: 'subproduct'; subproductId: string; title: string; priceCredits: number }
  | { purchaseType: 'bundle'; bundleOptionId: string; title: string; priceCredits: number }
type MarketOptionIconKind = 'sample' | 'bundle' | 'pdf' | 'hwp' | 'zip' | 'default'

const MARKET_ACTION_BUTTON_CLASS = 'h-11 w-full justify-center gap-2 rounded-xl px-5 font-semibold focus-visible:ring-indigo-300 sm:w-44'
const MARKET_PRIMARY_BUTTON_CLASS = `${MARKET_ACTION_BUTTON_CLASS} bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800`
const MARKET_OUTLINE_BUTTON_CLASS = `${MARKET_ACTION_BUTTON_CLASS} border border-indigo-500 bg-white text-indigo-600 hover:bg-indigo-50 active:border-indigo-800 active:text-indigo-800`
const MARKET_DISABLED_BUTTON_CLASS = `${MARKET_ACTION_BUTTON_CLASS} bg-slate-200 text-slate-400 hover:bg-slate-200`
const MARKET_OPTION_ICON_CLASS = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600'
const MARKET_BADGE_FREE_CLASS = 'rounded-full border border-[#E0E7FF] bg-[#F8FAFF] px-3 py-1 text-xs font-medium text-[#4F46E5] hover:bg-[#F8FAFF]'
const MARKET_BADGE_AVAILABLE_CLASS = 'rounded-full border border-[#E4E7EB] bg-[#F4F6F9] px-3 py-1 text-xs font-medium text-[#475569] hover:bg-[#F4F6F9]'
const MARKET_BADGE_OWNED_CLASS = 'rounded-full border border-[#D1FAE5] bg-[#ECFDF5] px-3 py-1 text-xs font-medium text-[#065F46] hover:bg-[#ECFDF5]'
const MARKET_BADGE_INCLUDED_CLASS = 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50'
const MARKET_DOWNLOAD_BUTTON_CLASS = 'h-9 min-w-36 w-full justify-center gap-2 rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-100 active:bg-emerald-200 focus-visible:ring-emerald-200 sm:w-auto'

function buildDownloadUrl(itemId: string, assetKind: 'pdf' | 'hwp' | 'zip') {
  return `/api/market/items/${itemId}/download?assetKind=${assetKind}`
}

function buildV2DownloadUrl(itemId: string, fileId: string) {
  return `/api/market/items/${itemId}/download?fileId=${fileId}`
}

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
}

function getAssetLabel(assetKind: PurchaseAssetKind) {
  if (assetKind === 'pdf') return 'PDF'
  if (assetKind === 'hwp') return 'HWP & PDF'
  return 'ZIP'
}

function getSubproductIconKind(subproduct: MarketSubproductPublicSummary): MarketOptionIconKind {
  const tokens = subproduct.fileTypes
    .flatMap((fileType) => [fileType.code, fileType.label, fileType.extension])
    .join(' ')
    .toLowerCase()

  if (tokens.includes('zip')) return 'zip'
  if (tokens.includes('hwp')) return 'hwp'
  if (tokens.includes('pdf')) return 'pdf'
  return 'default'
}

function getMarketDownloadButtonLabel(file: MarketSubproductDownloadFile) {
  const fileTypeLabel = file.fileTypeLabel.trim() || '파일'
  const subproductTitle = file.subproductTitle.trim() || '자료'
  const typedTitle = subproductTitle.replace(/\s*[\(（][^\)）]*[\)）]\s*$/, `(${fileTypeLabel})`)
  const labelTitle = typedTitle === subproductTitle
    ? `${subproductTitle}(${fileTypeLabel})`
    : typedTitle

  return `${labelTitle} 다운로드`
}

function MarketOptionIcon({ kind }: { kind: MarketOptionIconKind }) {
  if (kind === 'sample') {
    return (
      <div className={MARKET_OPTION_ICON_CLASS}>
        <span className="relative flex h-6 w-6 items-center justify-center">
          <FileText className="h-6 w-6" />
          <Eye className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-white p-[2px] text-indigo-600" />
        </span>
      </div>
    )
  }

  const icon = kind === 'bundle'
    ? <FileStack className="h-6 w-6" />
    : kind === 'zip'
      ? <FileArchive className="h-6 w-6" />
      : kind === 'hwp'
        ? <FileCheck2 className="h-6 w-6" />
        : <FileText className="h-6 w-6" />

  return <div className={MARKET_OPTION_ICON_CLASS}>{icon}</div>
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
    </div>
  )
}

function FileTypeBadges({ subproduct }: { subproduct: MarketSubproductPublicSummary }) {
  return (
    <div className="flex flex-wrap gap-1">
      {subproduct.fileTypes.map((fileType) => (
        <Badge key={fileType.id} variant="outline" className="bg-white text-[11px]">{fileType.label}</Badge>
      ))}
    </div>
  )
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
    return <Badge variant="secondary" className={MARKET_BADGE_FREE_CLASS}>무료</Badge>
  }

  if (state === 'owned') {
    return <Badge variant="secondary" className={MARKET_BADGE_OWNED_CLASS}>구매 완료</Badge>
  }

  if (state === 'included') {
    return <Badge variant="secondary" className={MARKET_BADGE_INCLUDED_CLASS}>패키지 포함</Badge>
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

  return <Badge variant="secondary" className={MARKET_BADGE_AVAILABLE_CLASS}>미구매</Badge>
}

function FileOptionRow({
  title,
  description,
  priceLabel,
  priceCaption = '이용가',
  state,
  icon,
  actionLabel,
  actionIcon,
  href,
  disabled,
  buttonClassName,
  badgeSlot,
  meta,
  actionSlot,
  className,
  onAction,
  onIntent,
}: {
  title: string
  description: string
  priceLabel?: string
  priceCaption?: string
  state: OptionState
  icon: ReactNode
  actionLabel: string
  actionIcon?: ReactNode
  href?: string
  disabled?: boolean
  buttonClassName?: string
  badgeSlot?: ReactNode
  meta?: ReactNode
  actionSlot?: ReactNode
  className?: string
  onAction?: () => void
  onIntent?: () => void
}) {
  const resolvedButtonClassName = buttonClassName ?? (state === 'unavailable' ? MARKET_DISABLED_BUTTON_CLASS : MARKET_OUTLINE_BUTTON_CLASS)
  const rowClassName = [
    'rounded-2xl border bg-white p-4 shadow-sm',
    className,
  ].filter(Boolean).join(' ')
  const footerClassName = [
    'mt-4 flex flex-col gap-3 sm:flex-row sm:items-end',
    priceLabel ? 'sm:justify-between' : 'sm:justify-end',
  ].join(' ')

  return (
    <div className={rowClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {icon}
          <div className="min-w-0">
            <p className="font-semibold text-slate-950">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
            {meta ? <div className="mt-2">{meta}</div> : null}
          </div>
        </div>
        {badgeSlot ?? <OptionStateBadge state={state} />}
      </div>
      <div className={footerClassName}>
        {priceLabel ? (
          <div>
            <p className="text-xs text-slate-500">{priceCaption}</p>
            <p className="mt-1 text-lg font-bold text-slate-950">{priceLabel}</p>
          </div>
        ) : null}
        {actionSlot ?? (href ? (
          <Button asChild className={resolvedButtonClassName} disabled={disabled}>
            <a href={href} aria-label={`${title} ${actionLabel}`}>
              {actionIcon}
              {actionLabel}
            </a>
          </Button>
        ) : (
          <Button
            className={resolvedButtonClassName}
            disabled={disabled}
            onClick={onAction}
            onFocus={onIntent}
            onMouseEnter={onIntent}
            onTouchStart={onIntent}
            aria-label={`${title} ${actionLabel}`}
          >
            {actionIcon}
            {actionLabel}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default function MarketItemActions({
  itemId,
  hasSamplePages,
  hasLegacySample,
  hasPdf,
  hasHwp,
  hasZip,
  isLoggedIn,
  ownsPdf,
  ownsHwp,
  ownsZip,
  pdfPrice,
  hwpPrice,
  zipPrice,
  samplePageCount,
  workspaceSubject,
  subproducts = [],
  bundleOption = null,
  downloadFiles = [],
}: MarketItemActionsProps) {
  const router = useRouter()
  const { redirectToLogin } = useLoginRedirect()
  const [isPending, startTransition] = useTransition()
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [pendingPurchaseKind, setPendingPurchaseKind] = useState<PurchaseAssetKind | null>(null)
  const [pendingV2PurchaseIntent, setPendingV2PurchaseIntent] = useState<V2PurchaseIntent | null>(null)
  const [purchaseCompleteMessage, setPurchaseCompleteMessage] = useState<string | null>(null)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)
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
    setPendingV2PurchaseIntent(null)
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

  const openV2PurchaseConfirmation = async (intent: V2PurchaseIntent) => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    setPendingPurchaseKind(null)
    setPendingV2PurchaseIntent(intent)
    setIsCheckingBalance(true)
    try {
      await fetchBalance()
      setShowConfirmation(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '크레딧 확인에 실패했습니다.')
      setPendingV2PurchaseIntent(null)
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const handleConfirmPurchase = () => {
    if (!pendingPurchaseKind && !pendingV2PurchaseIntent) {
      return
    }

    setShowConfirmation(false)
    startTransition(async () => {
      try {
        const requestBody = pendingV2PurchaseIntent
          ? pendingV2PurchaseIntent.purchaseType === 'subproduct'
            ? {
              purchaseType: 'subproduct',
              subproductId: pendingV2PurchaseIntent.subproductId,
              idempotencyKey: `${itemId}:subproduct:${pendingV2PurchaseIntent.subproductId}:${Date.now()}`,
            }
            : {
              purchaseType: 'bundle',
              bundleOptionId: pendingV2PurchaseIntent.bundleOptionId,
              idempotencyKey: `${itemId}:bundle:${pendingV2PurchaseIntent.bundleOptionId}:${Date.now()}`,
            }
          : { assetKind: pendingPurchaseKind }
        const response = await fetch(`/api/market/items/${itemId}/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || !payload.success) {
          throw new Error(getPurchaseErrorMessage(response.status, payload.error?.message))
        }

        if (typeof payload.balance === 'number') {
          setCurrentBalance(payload.balance)
          window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: payload.balance } }))
        }

        const fallbackMessage = pendingV2PurchaseIntent
          ? `${pendingV2PurchaseIntent.title} 구매가 완료되었습니다.`
          : `${getAssetLabel(pendingPurchaseKind as PurchaseAssetKind)} 구매가 완료되었습니다.`
        setPurchaseCompleteMessage(payload.message || fallbackMessage)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '구매 처리 중 오류가 발생했습니다.')
        router.refresh()
      } finally {
        setPendingPurchaseKind(null)
        setPendingV2PurchaseIntent(null)
      }
    })
  }

  const requiredCredits = pendingV2PurchaseIntent
    ? pendingV2PurchaseIntent.priceCredits
    : pendingPurchaseKind === 'pdf'
    ? pdfPrice
    : pendingPurchaseKind === 'hwp'
      ? hwpPrice
      : pendingPurchaseKind === 'zip'
        ? zipPrice
        : 0

  const confirmationDescription = pendingV2PurchaseIntent
    ? `${pendingV2PurchaseIntent.title} 자료를 크레딧으로 구매합니다.`
    : pendingPurchaseKind === 'pdf'
    ? 'PDF 파일을 크레딧으로 구매합니다.'
    : pendingPurchaseKind === 'hwp'
      ? 'PDF와 HWP 파일을 함께 크레딧으로 구매합니다.'
      : pendingPurchaseKind === 'zip'
        ? 'ZIP 파일을 크레딧으로 구매합니다.'
        : '문제마켓 자료를 크레딧으로 구매합니다.'

  const getPaidOptionState = (assetKind: PurchaseAssetKind, owned: boolean, available: boolean): OptionState => {
    if (owned) return 'owned'
    if (!available) return 'unavailable'
    if (pendingPurchaseKind === assetKind && isPending) return 'processing'
    if (pendingPurchaseKind === assetKind && isCheckingBalance) return 'checking'
    return 'available'
  }

  const openSamplePreview = () => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    setIsSamplePreviewOpen(true)
  }

  const prefetchSamplePreview = () => {
    if (!isLoggedIn || !hasSamplePages) {
      return
    }

    setSamplePreviewPrefetchKey((value) => value + 1)
  }

  const getV2OptionState = (intent: V2PurchaseIntent, owned: boolean): OptionState => {
    if (owned) return 'owned'

    const isSameIntent = pendingV2PurchaseIntent
      ? intent.purchaseType === 'bundle'
        ? pendingV2PurchaseIntent.purchaseType === 'bundle' && pendingV2PurchaseIntent.bundleOptionId === intent.bundleOptionId
        : pendingV2PurchaseIntent.purchaseType === 'subproduct' && pendingV2PurchaseIntent.subproductId === intent.subproductId
      : false

    if (isSameIntent && isPending) return 'processing'
    if (isSameIntent && isCheckingBalance) return 'checking'
    return 'available'
  }

  const renderV2PurchaseOptions = () => {
    const filesBySubproduct = new Map<string, MarketSubproductDownloadFile[]>()
    for (const file of downloadFiles) {
      const current = filesBySubproduct.get(file.subproductId) ?? []
      current.push(file)
      filesBySubproduct.set(file.subproductId, current)
    }

    const renderDownloadButtons = (files: MarketSubproductDownloadFile[]) => {
      if (files.length === 0) {
        return <p className="text-xs font-medium text-slate-500">다운로드 가능한 파일을 준비 중입니다.</p>
      }

      return (
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          {files.map((file) => {
            const downloadLabel = getMarketDownloadButtonLabel(file)

            return (
              <Button key={file.id} asChild className={MARKET_DOWNLOAD_BUTTON_CLASS}>
                <a href={buildV2DownloadUrl(itemId, file.id)} aria-label={downloadLabel}>
                  <Download className="h-4 w-4" />
                  {downloadLabel}
                </a>
              </Button>
            )
          })}
        </div>
      )
    }

    return (
      <div className="space-y-5">
        {bundleOption ? (
          <section className="space-y-3">
            <SectionHeading title="전체 패키지" description="아래 개별 상품을 한 번에 구매하는 추천 옵션입니다." />
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-md">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-white">추천</Badge>
                <Badge variant="secondary" className="rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs font-semibold text-cyan-700 hover:bg-white">전체 포함</Badge>
                <Badge variant="secondary" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-white">{subproducts.length}개 자료</Badge>
              </div>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <MarketOptionIcon kind="bundle" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">전체 패키지</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {bundleOption.description || `한 번 구매하면 아래 개별 자료 ${subproducts.length}개를 모두 다운로드할 수 있습니다.`}
                    </p>
                  </div>
                </div>
                <OptionStateBadge state={getV2OptionState({
                  purchaseType: 'bundle',
                  bundleOptionId: bundleOption.id,
                  title: bundleOption.label || '전체 패키지',
                  priceCredits: bundleOption.priceCredits,
                }, bundleOption.owned)} />
              </div>
              <div className="mt-4 rounded-xl border border-emerald-100 bg-white/75 p-3">
                <p className="text-xs font-semibold text-emerald-800">포함 자료</p>
                <div className="mt-3 space-y-2">
                  {subproducts.length > 0 ? subproducts.map((subproduct) => (
                    <div key={subproduct.id} className="flex gap-2 text-xs text-slate-700">
                      <span className="mt-0.5 font-bold text-emerald-600">✓</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{subproduct.title}</p>
                        <div className="mt-1">
                          <FileTypeBadges subproduct={subproduct} />
                        </div>
                      </div>
                    </div>
                  )) : (
                    <p className="text-xs leading-5 text-slate-500">포함 상품 정보가 아직 표시되지 않습니다.</p>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs text-slate-500">패키지 이용가</p>
                  <p className="mt-1 text-xl font-bold text-slate-950">{formatCredits(bundleOption.priceCredits)} 크레딧</p>
                </div>
                {bundleOption.owned ? renderDownloadButtons(downloadFiles) : (
                  <Button
                    className={MARKET_PRIMARY_BUTTON_CLASS}
                    disabled={isPending || isCheckingBalance}
                    onClick={() => void openV2PurchaseConfirmation({
                      purchaseType: 'bundle',
                      bundleOptionId: bundleOption.id,
                      title: bundleOption.label || '전체 패키지',
                      priceCredits: bundleOption.priceCredits,
                    })}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    전체 패키지 구매
                  </Button>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {subproducts.length > 0 ? (
          <section className="space-y-3">
            {bundleOption ? (
              <div className="flex items-center gap-3 text-xs font-semibold text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                <span>또는 필요한 자료만</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            ) : null}
            <SectionHeading title="개별 자료 선택 구매" description="전체 패키지가 필요 없다면 원하는 자료만 구매하세요." />
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              {subproducts.map((subproduct) => {
                const ownedFiles = filesBySubproduct.get(subproduct.id) ?? []
                const fileTypeLabels = subproduct.fileTypes.map((fileType) => fileType.label).join(' · ') || '파일'
                const iconKind = getSubproductIconKind(subproduct)
                const isBundleIncluded = Boolean(bundleOption?.owned && !subproduct.owned)
                const isDownloadable = subproduct.owned || Boolean(bundleOption?.owned)
                const subproductState = isBundleIncluded
                  ? 'included'
                  : getV2OptionState({
                    purchaseType: 'subproduct',
                    subproductId: subproduct.id,
                    title: subproduct.title,
                    priceCredits: subproduct.priceCredits,
                  }, subproduct.owned)

                return (
                  <FileOptionRow
                    key={subproduct.id}
                    title={subproduct.title}
                    description={subproduct.description || `${subproduct.categoryName} · ${fileTypeLabels}`}
                    priceLabel={`${formatCredits(subproduct.priceCredits)} 크레딧`}
                    priceCaption="개별가"
                    state={subproductState}
                    icon={<MarketOptionIcon kind={iconKind} />}
                    actionLabel={isDownloadable ? '다운로드' : '이 자료만 구매'}
                    actionIcon={isDownloadable ? <Download className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
                    buttonClassName={MARKET_OUTLINE_BUTTON_CLASS}
                    actionSlot={isDownloadable ? renderDownloadButtons(ownedFiles) : undefined}
                    disabled={isPending || isCheckingBalance}
                    meta={<FileTypeBadges subproduct={subproduct} />}
                    className="rounded-xl border-slate-200 p-3 shadow-none"
                    onAction={!isDownloadable ? () => void openV2PurchaseConfirmation({
                      purchaseType: 'subproduct',
                      subproductId: subproduct.id,
                      title: subproduct.title,
                      priceCredits: subproduct.priceCredits,
                    }) : undefined}
                  />
                )
              })}
            </div>
          </section>
        ) : null}
      </div>
    )
  }

  const hasV2PurchaseOptions = subproducts.length > 0 || bundleOption !== null
  const libraryPurchaseLabel = workspaceSubject === 'korean'
    ? '국어 라이브러리 > 구매자료'
    : '영어 라이브러리 > 구매자료'

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <SectionHeading title="무료 샘플" description="구매 전 자료 구성을 먼저 확인하세요." />
        <FileOptionRow
          title={hasSamplePages ? '무료 샘플 미리보기' : '샘플 준비 중'}
          description={hasSamplePages
            ? `구매 전 PDF 첫 ${samplePageCount}쪽을 확인할 수 있어요.`
            : hasLegacySample
              ? '기존 샘플 PDF는 판매용 PDF 재업로드 후 JPG 미리보기로 대체됩니다.'
              : '현재 이 자료는 미리보기를 제공하지 않습니다.'}
          state={hasSamplePages ? 'instant' : 'unavailable'}
          icon={<MarketOptionIcon kind="sample" />}
          actionLabel={hasSamplePages ? '샘플 보기' : '샘플 없음'}
          actionIcon={hasSamplePages ? <Eye className="h-4 w-4" /> : undefined}
          disabled={!hasSamplePages}
          badgeSlot={hasSamplePages ? (
            <div className="flex flex-wrap justify-end gap-1">
              <Badge variant="secondary" className={MARKET_BADGE_FREE_CLASS}>무료</Badge>
              <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">구매 전 확인</Badge>
            </div>
          ) : undefined}
          className="border-sky-100 bg-sky-50/40"
          onAction={hasSamplePages ? openSamplePreview : undefined}
          onIntent={hasSamplePages ? prefetchSamplePreview : undefined}
        />
      </section>

      {hasV2PurchaseOptions ? renderV2PurchaseOptions() : (
        <>

      {(hasPdf || ownsPdf) ? (
        <FileOptionRow
          title="PDF"
          description={ownsPdf ? '구매 완료된 PDF 파일입니다.' : '구매 후 바로 PDF를 다운로드할 수 있습니다.'}
          priceLabel={`${formatCredits(pdfPrice)} 크레딧`}
          state={getPaidOptionState('pdf', ownsPdf, hasPdf)}
          icon={ownsPdf ? <MarketOptionIcon kind="default" /> : <MarketOptionIcon kind="pdf" />}
          actionLabel={ownsPdf ? 'PDF 다운로드' : 'PDF 구매하기'}
          actionIcon={ownsPdf ? <Download className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
          href={ownsPdf ? buildDownloadUrl(itemId, 'pdf') : undefined}
          disabled={!hasPdf || isPending || isCheckingBalance}
          buttonClassName={ownsPdf ? MARKET_DOWNLOAD_BUTTON_CLASS : undefined}
          onAction={!ownsPdf && hasPdf ? () => void openPurchaseConfirmation('pdf') : undefined}
        />
      ) : null}

      {(hasHwp || ownsHwp) ? (
        <FileOptionRow
          title="HWP & PDF"
          description={ownsHwp ? '구매 완료된 HWP & PDF 묶음입니다.' : '구매 후 PDF와 HWP를 모두 다운로드할 수 있습니다.'}
          priceLabel={`${formatCredits(hwpPrice)} 크레딧`}
          state={getPaidOptionState('hwp', ownsHwp, hasHwp)}
          icon={ownsHwp ? <MarketOptionIcon kind="default" /> : <MarketOptionIcon kind="hwp" />}
          actionLabel={ownsHwp ? 'HWP 다운로드' : 'HWP & PDF 구매하기'}
          actionIcon={ownsHwp ? <Download className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
          href={ownsHwp ? buildDownloadUrl(itemId, 'hwp') : undefined}
          disabled={!hasHwp || isPending || isCheckingBalance}
          buttonClassName={ownsHwp ? MARKET_DOWNLOAD_BUTTON_CLASS : undefined}
          onAction={!ownsHwp && hasHwp ? () => void openPurchaseConfirmation('hwp') : undefined}
        />
      ) : null}
      {(hasZip || ownsZip) ? (
        <FileOptionRow
          title="ZIP"
          description={ownsZip ? '구매 완료된 ZIP 파일입니다.' : '구매 후 ZIP 파일을 다운로드할 수 있습니다.'}
          priceLabel={`${formatCredits(zipPrice)} 크레딧`}
          state={getPaidOptionState('zip', ownsZip, hasZip)}
          icon={ownsZip ? <MarketOptionIcon kind="default" /> : <MarketOptionIcon kind="zip" />}
          actionLabel={ownsZip ? 'ZIP 다운로드' : 'ZIP 구매하기'}
          actionIcon={ownsZip ? <Download className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
          href={ownsZip ? buildDownloadUrl(itemId, 'zip') : undefined}
          disabled={!hasZip || isPending || isCheckingBalance}
          buttonClassName={ownsZip ? MARKET_DOWNLOAD_BUTTON_CLASS : undefined}
          onAction={!ownsZip && hasZip ? () => void openPurchaseConfirmation('zip') : undefined}
        />
      ) : null}
        </>
      )}

      <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        구매 후 바로 다운로드할 수 있으며, 구매한 파일은 <span className="font-semibold text-slate-700">{libraryPurchaseLabel}</span>에서도 확인할 수 있습니다.
      </div>

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => {
          if (isPending) return
          setShowConfirmation(false)
          setPendingPurchaseKind(null)
          setPendingV2PurchaseIntent(null)
        }}
        onConfirm={handleConfirmPurchase}
        requiredAmount={requiredCredits}
        currentBalance={currentBalance}
        isLoading={isPending || isCheckingBalance}
        title="문제마켓 구매 확인"
        description={confirmationDescription}
      />

      <MarketPurchaseCompleteDialog
        message={purchaseCompleteMessage}
        onClose={() => setPurchaseCompleteMessage(null)}
      />

      <MarketSamplePreviewDialog
        itemId={itemId}
        workspaceSubject={workspaceSubject}
        open={isSamplePreviewOpen}
        prefetchKey={samplePreviewPrefetchKey}
        onOpenChange={setIsSamplePreviewOpen}
      />
    </div>
  )
}
