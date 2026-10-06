'use client'

import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Eye, FileArchive, FileCheck2, FileStack, FileText, ShoppingCart } from 'lucide-react'
import { FileTypeDocIcon } from '@/components/market/file-type-doc-icon'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { dispatchMarketCartUpdated } from '@/components/market/market-cart-indicator'
import { MarketCheckoutConfirmDialog } from '@/components/market/market-checkout-confirm-dialog'
import {
  MarketPurchaseCompleteDialog,
  resolveMarketLibraryHref,
  type MarketPurchaseCompleteResult,
} from '@/components/market/market-purchase-complete-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import { saveMarketCartIntent, takeMarketCartIntent } from '@/lib/market-cart-intent'
import { isPdfInclusiveHwp } from '@/lib/market-bundle-savings'
import { getMarketDownloadButtonLabel } from '@/lib/market-download-label'
import type { MarketBundlePublicSummary, MarketSubproductDownloadFile, MarketSubproductPublicSummary } from '@/lib/market-items-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import MarketSamplePreviewDialog from './market-sample-preview-dialog'

interface MarketItemActionsProps {
  itemId: string
  hasSamplePages: boolean
  hasLegacySample: boolean
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

type OptionState = 'instant' | 'owned' | 'included' | 'available' | 'unavailable' | 'checking' | 'processing'
type MarketOptionIconKind = 'sample' | 'bundle' | 'pdf' | 'hwp' | 'zip' | 'default'

interface PurchaseNotice {
  label: string
  text: string
}

// 선택 가능한 구매 옵션. key = `${targetKind}:${targetId}` (409 응답의 targetKind·targetId와 대조한다)
interface PurchaseOption {
  key: string
  targetKind: 'subproduct' | 'bundle'
  targetId: string
  title: string
  priceCredits: number
  categorySlug: string | null
  includesPdf: boolean
  partiallyOwned: boolean
  unavailableReason: string | null
}

interface CheckoutLine {
  key: string
  targetKind: 'subproduct' | 'bundle'
  targetId: string
  title: string
  expectedCredits: number
  // 409 PRICE_CHANGED로 바뀐 경우 직전에 확인했던 금액
  previousCredits: number | null
  partiallyOwned: boolean
}

interface CheckoutState {
  // Dialog를 열 때 1개 생성. 확정·재시도는 같은 키, 409 재확인은 새 키.
  idempotencyKey: string
  lines: CheckoutLine[]
  balance: number
  acknowledged: boolean
  submitting: boolean
  retryable: boolean
  notice: string | null
  shortfall: number | null
}

interface CartAddHandlers {
  onUnauthorized: () => void
  // 담기 요청이 전부 실패했을 때의 안내(선택 담기는 toast, 로그인 복귀 담기는 안내 Dialog)
  onFailure: (message: string) => void
  // 로그인 복귀 담기에서 담을 수 없어 제외한 대상 수. 성공 문구 끝에 알린다.
  excludedCount?: number
}

interface PriceChangedItem {
  targetKind: string
  targetId: string
  purchasable: boolean
  chargedCredits: number | null
}

const MARKET_ACTION_BUTTON_CLASS = 'h-11 w-full justify-center gap-2 rounded-xl px-5 font-semibold focus-visible:ring-indigo-300 sm:w-44'
const MARKET_OUTLINE_BUTTON_CLASS = `${MARKET_ACTION_BUTTON_CLASS} border border-indigo-500 bg-white text-indigo-600 hover:bg-indigo-50 active:border-indigo-800 active:text-indigo-800`
const MARKET_DISABLED_BUTTON_CLASS = `${MARKET_ACTION_BUTTON_CLASS} bg-slate-200 text-slate-400 hover:bg-slate-200`
const MARKET_OPTION_ICON_CLASS = 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600'
const MARKET_BADGE_FREE_CLASS = 'rounded-full border border-[#E0E7FF] bg-[#F8FAFF] px-3 py-1 text-xs font-medium text-[#4F46E5] hover:bg-[#F8FAFF]'
const MARKET_BADGE_AVAILABLE_CLASS = 'rounded-full border border-[#E4E7EB] bg-[#F4F6F9] px-3 py-1 text-xs font-medium text-[#475569] hover:bg-[#F4F6F9]'
const MARKET_BADGE_OWNED_CLASS = 'rounded-full border border-[#D1FAE5] bg-[#ECFDF5] px-3 py-1 text-xs font-medium text-[#065F46] hover:bg-[#ECFDF5]'
const MARKET_BADGE_INCLUDED_CLASS = 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50'
// 자료 보관함 다운로드 버튼과 동일한 디자인 (흰 배경·회색 테두리·파일타입 색상 아이콘)
const MARKET_DOWNLOAD_BUTTON_CLASS = 'h-9 min-w-36 w-full justify-center gap-1.5 rounded-md border border-[var(--studio-control-border,#7f8499)] bg-white px-3 text-sm font-medium text-[var(--studio-ink,#1c1f2e)] hover:bg-white hover:border-[var(--studio-primary-border,#c9befa)] hover:text-[var(--studio-primary,#6950e5)] active:bg-slate-50 focus-visible:ring-[var(--studio-focus-ring,#8b76ec)] sm:w-auto'
const UNPRICED_REASON = '가격이 정해지지 않아 선택할 수 없습니다.'
const NO_FILES_REASON = '파일 준비 중이라 선택할 수 없습니다.'
const BUNDLE_SELECTED_REASON = '전체 패키지에 포함되어 함께 선택할 수 없습니다. 개별 구매는 전체 패키지 선택을 해제하세요.'
const SUBPRODUCT_SELECTED_REASON = '개별 자료를 선택한 상태에서는 전체 패키지를 함께 선택할 수 없습니다.'
const PDF_HWP_CONFLICT_REASON = '문제(HWP)에 PDF가 포함되어 있어 함께 선택할 수 없습니다.'
const DEFAULT_HWP_PDF_NOTICE = {
  label: 'PDF 포함',
  text: '편집 가능한 HWP와 문제(PDF)를 함께 제공합니다. PDF는 따로 구매하지 않아도 됩니다.',
}

function buildDownloadUrl(itemId: string, assetKind: 'pdf' | 'hwp' | 'zip') {
  return `/api/market/items/${itemId}/download?assetKind=${assetKind}`
}

function buildV2DownloadUrl(itemId: string, fileId: string) {
  return `/api/market/items/${itemId}/download?fileId=${fileId}`
}

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
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

function sumCredits(lines: { expectedCredits: number }[]) {
  return lines.reduce((total, line) => total + line.expectedCredits, 0)
}

function hasHwpAndPdf(subproduct: MarketSubproductPublicSummary) {
  const codes = new Set(subproduct.fileTypes.map((fileType) => fileType.code.toLowerCase()))
  return codes.has('hwp') && codes.has('pdf')
}

function resolveSubproductPurchaseNotice(subproduct: MarketSubproductPublicSummary): PurchaseNotice | null {
  const customText = subproduct.purchaseNoticeText?.trim()

  if (customText) {
    return {
      label: subproduct.purchaseNoticeLabel?.trim() || DEFAULT_HWP_PDF_NOTICE.label,
      text: customText,
    }
  }

  if (hasHwpAndPdf(subproduct)) {
    return DEFAULT_HWP_PDF_NOTICE
  }

  return null
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

function FileTypeBadges({ subproduct, siblings }: {
  subproduct: MarketSubproductPublicSummary
  // 전달 시 문제(PDF)/문제(HWP) 간 중복 PDF 배지를 숨긴다 (다운로드 dedupe 규칙과 동일)
  siblings?: MarketSubproductPublicSummary[]
}) {
  let fileTypes = subproduct.fileTypes
  if (siblings && subproduct.categorySlug === 'question_hwp') {
    const hasQuestionPdfPdf = siblings.some((sibling) => (
      sibling.categorySlug === 'question_pdf'
      && sibling.fileTypes.some((fileType) => fileType.code.toLowerCase() === 'pdf')
    ))
    if (hasQuestionPdfPdf) {
      fileTypes = fileTypes.filter((fileType) => fileType.code.toLowerCase() !== 'pdf')
    }
  }
  return (
    <div className="flex flex-wrap gap-1">
      {fileTypes.map((fileType) => (
        <Badge key={fileType.id} variant="outline" className="bg-white text-[11px]">{fileType.label}</Badge>
      ))}
    </div>
  )
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
  notice,
  actionSlot,
  selectSlot,
  showDefaultAction = true,
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
  notice?: PurchaseNotice | null
  actionSlot?: ReactNode
  // 카드 맨 위 첫 줄(좌상단)에 두는 선택 컨트롤
  selectSlot?: ReactNode
  // 비보유(선택형) 행은 false로 두어 actionSlot이 비어도 기본 Button을 만들지 않는다
  showDefaultAction?: boolean
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
      {selectSlot ? <div className="mb-2">{selectSlot}</div> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {icon}
          <div className="min-w-0">
            <p className="font-semibold text-slate-950">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
            {meta ? <div className="mt-2">{meta}</div> : null}
            {notice ? (
              <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs leading-5 text-slate-600">
                <span className="mr-2 inline-flex rounded-full bg-white px-2 py-0.5 font-semibold text-indigo-700">{notice.label}</span>
                <span>{notice.text}</span>
              </div>
            ) : null}
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
        {actionSlot ?? (!showDefaultAction ? null : href ? (
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
  const searchParams = useSearchParams()
  // 방금 완료된 로그인의 증거. LoginCompleteDialog가 닫히면서 이 쿼리를 지운다.
  const isLoginCompletePending = searchParams.get('login') === 'success'
  const cartIntentConsumed = useRef(false)
  const selectionIdPrefix = useId()
  // 선택 순서를 유지한다(장바구니 담기 순서). 새로고침으로 사라지거나 선택 불가가 된 옵션은 purchaseOptions 대조로 걸러진다.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isAddingToCart, setIsAddingToCart] = useState(false)
  const [checkout, setCheckout] = useState<CheckoutState | null>(null)
  const [purchaseComplete, setPurchaseComplete] = useState<MarketPurchaseCompleteResult | null>(null)
  // 담기 결과 Dialog. 'notice'는 로그인 복귀 담기의 실패·제외 안내다(로그인 완료 모달 뒤라 toast는 묻힌다).
  const [cartResult, setCartResult] = useState<{ kind: 'added' | 'notice'; message: string } | null>(null)
  // 비로그인 0건에서 [로그인 후 담기]·[로그인 후 구매]를 누른 경우의 인라인 안내
  const [emptyNotice, setEmptyNotice] = useState(false)
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
      window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: data.balance } }))
      return data.balance as number
    }
    throw new Error('잔액 정보 형식이 올바르지 않습니다.')
  }

  // 문제(HWP) 서브상품(PDF 포함)을 단건 소유한 경우, 이미 포함된 문제(PDF) 카드는 숨긴다.
  // ownedScope 는 번들 소유 시 'item' 이므로 번들 소유자는 숨김 대상이 아니다.
  const hasOwnedPdfInclusiveHwp = subproducts.some((sibling) => (
    isPdfInclusiveHwp(sibling) && sibling.ownedScope === 'subproduct'
  ))
  // R6: 개별 자료를 이미 보유한 채 전체 패키지를 사면 정가 구매다. 확인 Dialog에서 확인 여부를 함께 보낸다.
  const isPartiallyOwnedBundle = subproducts.some((subproduct) => subproduct.ownedScope === 'subproduct')

  // 표시·expectedCredits 비교용 가격. 차감액은 RPC가 다시 계산하고, 다르면 409로 알린다.
  const purchaseOptions: PurchaseOption[] = []
  if (bundleOption && !bundleOption.owned) {
    purchaseOptions.push({
      key: `bundle:${bundleOption.id}`,
      targetKind: 'bundle',
      targetId: bundleOption.id,
      title: bundleOption.label || '전체 패키지',
      priceCredits: bundleOption.priceCredits,
      categorySlug: null,
      includesPdf: false,
      partiallyOwned: isPartiallyOwnedBundle,
      unavailableReason: bundleOption.priceCredits <= 0
        ? UNPRICED_REASON
        : subproducts.every((subproduct) => subproduct.fileCount === 0) ? NO_FILES_REASON : null,
    })
  }
  if (!bundleOption?.owned) {
    for (const subproduct of subproducts) {
      if (subproduct.owned || (subproduct.categorySlug === 'question_pdf' && hasOwnedPdfInclusiveHwp)) {
        continue
      }
      const priceCredits = subproduct.upgradePriceCredits ?? subproduct.priceCredits
      purchaseOptions.push({
        key: `subproduct:${subproduct.id}`,
        targetKind: 'subproduct',
        targetId: subproduct.id,
        title: subproduct.title,
        priceCredits,
        categorySlug: subproduct.categorySlug,
        includesPdf: isPdfInclusiveHwp(subproduct),
        partiallyOwned: false,
        unavailableReason: priceCredits <= 0
          ? UNPRICED_REASON
          : subproduct.fileCount === 0 ? NO_FILES_REASON : null,
      })
    }
  }
  const optionByKey = new Map(purchaseOptions.map((option) => [option.key, option]))

  // 옵션 목록이 바뀌면(새로고침 등) 선택할 수 없게 된 key를 버린다. 나중에 다시 선택 가능해져도 자동 재선택되지 않는다.
  const selectableKeys = purchaseOptions.filter((option) => option.unavailableReason === null).map((option) => option.key)
  const selectableKeySignature = selectableKeys.join('|')
  const [prunedKeySignature, setPrunedKeySignature] = useState(selectableKeySignature)
  if (prunedKeySignature !== selectableKeySignature) {
    setPrunedKeySignature(selectableKeySignature)
    setSelectedKeys((current) => current.filter((key) => selectableKeys.includes(key)))
  }
  const selectedOptions = selectedKeys.flatMap((key) => {
    const option = optionByKey.get(key)
    return option && option.unavailableReason === null ? [option] : []
  })
  const selectedKeySet = new Set(selectedOptions.map((option) => option.key))
  const selectedTotal = selectedOptions.reduce((total, option) => total + option.priceCredits, 0)
  const hasSelectableOption = purchaseOptions.some((option) => option.unavailableReason === null)
  const isBusy = isCheckingBalance || isAddingToCart || Boolean(checkout?.submitting)

  // 서버 R-규칙과 같은 충돌 규칙. 자동 교체 없이 상대 옵션을 막고, 선택을 해제하면 바로 풀린다.
  const hasSelectedBundle = selectedOptions.some((option) => option.targetKind === 'bundle')
  const hasSelectedSubproduct = selectedOptions.some((option) => option.targetKind === 'subproduct')
  const hasSelectedQuestionPdf = selectedOptions.some((option) => option.categorySlug === 'question_pdf')
  const hasSelectedPdfInclusiveHwp = selectedOptions.some((option) => option.includesPdf)

  const getBlockedReason = (option: PurchaseOption) => {
    if (option.unavailableReason) return option.unavailableReason
    if (selectedKeySet.has(option.key)) return null
    if (option.targetKind === 'subproduct' && hasSelectedBundle) return BUNDLE_SELECTED_REASON
    if (option.targetKind === 'bundle' && hasSelectedSubproduct) return SUBPRODUCT_SELECTED_REASON
    if ((option.categorySlug === 'question_pdf' && hasSelectedPdfInclusiveHwp) || (option.includesPdf && hasSelectedQuestionPdf)) {
      return PDF_HWP_CONFLICT_REASON
    }
    return null
  }

  const toggleOption = (key: string, checked: boolean) => {
    setEmptyNotice(false)
    setSelectedKeys((current) => (checked
      ? (current.includes(key) ? current : [...current, key])
      : current.filter((selectedKey) => selectedKey !== key)))
  }

  const clearSelection = () => setSelectedKeys([])

  // 선택 담기와 로그인 복귀 담기가 공유한다. 담기는 원자성이 필요 없고 target별 결과(CART_LIMIT 등)를 안내해야 하므로
  // 기존 POST를 순서대로 호출한다. 1건 이상 담기면 true.
  const addTargetsToCart = async (
    options: PurchaseOption[],
    { onUnauthorized, onFailure, excludedCount = 0 }: CartAddHandlers
  ) => {
    let createdCount = 0
    let existingCount = 0
    let limitCount = 0
    let failedCount = 0
    let latestCount: number | null = null
    setIsAddingToCart(true)
    try {
      for (const option of options) {
        let response: Response
        try {
          response = await fetch('/api/market/cart/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(option.targetKind === 'bundle'
              ? { targetKind: 'bundle', bundleOptionId: option.targetId }
              : { targetKind: 'subproduct', subproductId: option.targetId }),
          })
        } catch {
          failedCount += 1
          continue
        }
        const payload = await response.json().catch(() => ({}))

        if (response.status === 401) {
          onUnauthorized()
          return false
        }

        if (response.ok && payload.success) {
          latestCount = payload.data.count
          if (payload.data.created) {
            createdCount += 1
          } else {
            existingCount += 1
          }
        } else if (payload.error?.code === 'CART_LIMIT') {
          limitCount += 1
        } else {
          failedCount += 1
        }
      }
    } finally {
      setIsAddingToCart(false)
    }

    if (latestCount !== null) {
      dispatchMarketCartUpdated(latestCount)
    }

    const limitMessage = `장바구니가 가득 차(최대 50개) ${limitCount}건을 담지 못했습니다. 장바구니를 정리한 뒤 다시 담아 주세요.`
    if (createdCount + existingCount === 0) {
      onFailure(limitCount > 0 ? limitMessage : '장바구니에 담지 못했습니다. 잠시 후 다시 시도해주세요.')
      return false
    }

    setCartResult({
      kind: 'added',
      message: [
        createdCount > 0 ? `${createdCount}건을 담았습니다.` : null,
        existingCount > 0 ? `${existingCount}건은 이미 장바구니에 있습니다.` : null,
        limitCount > 0 ? limitMessage : null,
        failedCount > 0 ? `${failedCount}건은 오류로 담지 못했습니다.` : null,
        excludedCount > 0 ? `나머지 ${excludedCount}건은 이미 보유했거나 판매 중지·준비 중이라 제외했습니다.` : null,
      ].filter(Boolean).join(' '),
    })
    return true
  }

  // 비로그인은 선택을 저장한 뒤 로그인으로 보낸다. 로그인 후 이 상세로 돌아오면 담기는 자동으로 이어지고(12절 D16·D17),
  // 구매는 선택만 복원한다(D19, 차감은 사용자가 다시 눌러야 한다).
  const saveIntentBeforeLogin = (action: 'cart' | 'purchase') => {
    saveMarketCartIntent({
      action,
      itemId,
      workspaceSubject,
      targets: selectedOptions.map((option) => ({ targetKind: option.targetKind, targetId: option.targetId })),
    })
  }

  const addSelectedToCart = async () => {
    if (!isLoggedIn) {
      // 0건은 로그인으로 보내지 않는다(13절 D21). 복귀 후 이어갈 대상이 없고 의도도 저장하지 않는다.
      if (selectedOptions.length === 0) {
        setEmptyNotice(true)
        return
      }
      saveIntentBeforeLogin('cart')
      redirectToLogin()
      return
    }
    if (selectedOptions.length === 0) {
      return
    }

    if (await addTargetsToCart(selectedOptions, {
      onUnauthorized: () => redirectToLogin(),
      onFailure: (message) => toast.error(message),
    })) {
      clearSelection()
    }
  }

  // 로그인 상태 마운트에서 1회만 읽고 즉시 지운다. 1회 보장은 ref 가드와 storage 즉시 삭제로만 한다
  // (cleanup 취소 플래그를 두면 StrictMode 이중 실행에서 첫 POST는 나가고 결과 Dialog가 막힌다).
  const consumeCartIntent = useEffectEvent(() => {
    const intent = takeMarketCartIntent({ itemId, workspaceSubject })
    if (!intent || !isLoginCompletePending) {
      return
    }

    // 보유 옵션은 purchaseOptions에서 빠지므로 '보유·판매 중지'(option 없음)와 '준비 중'(unavailableReason)만 구분한다.
    // '가격 미정'도 unavailableReason이라 '준비 중'으로 묶인다(DTO로 판별 가능한 범위의 한계).
    let missingCount = 0
    let preparingCount = 0
    const options: PurchaseOption[] = []
    for (const target of intent.targets) {
      const option = optionByKey.get(`${target.targetKind}:${target.targetId}`)
      if (!option) {
        missingCount += 1
      } else if (option.unavailableReason !== null) {
        preparingCount += 1
      } else {
        options.push(option)
      }
    }

    if (intent.action === 'purchase') {
      setSelectedKeys(options.map((option) => option.key))
      return
    }

    // 로그인 완료 모달이 떠 있어 toast는 묻히므로, 실패·제외도 그 모달이 닫힌 뒤 Dialog로 알린다(13절 D22).
    const showNotice = (message: string) => setCartResult({ kind: 'notice', message })
    if (options.length === 0) {
      const reasons = [
        missingCount > 0 ? `이미 보유했거나 판매가 중지된 자료 ${missingCount}건` : null,
        preparingCount > 0 ? `준비 중이라 담을 수 없는 자료 ${preparingCount}건` : null,
      ].filter(Boolean)
      showNotice(`선택했던 자료를 담지 못했습니다. ${reasons.join(', ')}이 있습니다.`)
      return
    }
    // 복귀 담기 중 401은 다시 로그인으로 보내지 않는다(무한 이동 방지).
    void addTargetsToCart(options, {
      onUnauthorized: () => showNotice('로그인 상태를 확인하지 못해 담지 못했습니다. 다시 로그인한 뒤 시도해 주세요.'),
      onFailure: showNotice,
      excludedCount: missingCount + preparingCount,
    })
  })

  useEffect(() => {
    if (!isLoggedIn || cartIntentConsumed.current) {
      return
    }
    cartIntentConsumed.current = true
    consumeCartIntent()
  }, [isLoggedIn])

  const openCheckout = async () => {
    if (!isLoggedIn) {
      // 구매하기도 담기와 같은 규칙이다(13절 D21).
      if (selectedOptions.length === 0) {
        setEmptyNotice(true)
        return
      }
      saveIntentBeforeLogin('purchase')
      redirectToLogin()
      return
    }
    if (selectedOptions.length === 0) {
      return
    }

    setIsCheckingBalance(true)
    try {
      const balance = await fetchBalance()
      setCheckout({
        idempotencyKey: crypto.randomUUID(),
        lines: selectedOptions.map((option) => ({
          key: option.key,
          targetKind: option.targetKind,
          targetId: option.targetId,
          title: option.title,
          expectedCredits: option.priceCredits,
          previousCredits: null,
          partiallyOwned: option.partiallyOwned,
        })),
        balance,
        acknowledged: false,
        submitting: false,
        retryable: false,
        notice: null,
        shortfall: null,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '크레딧 확인에 실패했습니다.')
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const submitCheckout = async () => {
    if (!checkout || checkout.submitting) {
      return
    }

    const request = checkout
    setCheckout({ ...request, submitting: true })

    let response: Response
    try {
      response = await fetch(`/api/market/items/${itemId}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: request.lines.map((line) => ({
            target: line.targetKind === 'bundle'
              ? { targetKind: 'bundle', bundleOptionId: line.targetId }
              : { targetKind: 'subproduct', subproductId: line.targetId },
            expectedCredits: line.expectedCredits,
            acknowledgeNoDiscount: line.partiallyOwned && request.acknowledged,
          })),
          idempotencyKey: request.idempotencyKey,
        }),
      })
    } catch {
      setCheckout({
        ...request,
        submitting: false,
        retryable: true,
        notice: '네트워크 오류로 구매 결과를 확인하지 못했습니다. 다시 시도하면 같은 요청으로 처리되어 중복으로 차감되지 않습니다.',
      })
      return
    }

    const payload = await response.json().catch(() => ({}))

    if (response.ok && payload.success) {
      setCheckout(null)
      if (typeof payload.balance === 'number') {
        window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: payload.balance } }))
      }
      setPurchaseComplete({
        orders: payload.data?.orders ?? [],
        totalCredits: payload.data?.totalCredits ?? sumCredits(request.lines),
        balance: typeof payload.balance === 'number' ? payload.balance : null,
        alreadyCompleted: payload.alreadyCompleted === true,
      })
      clearSelection()
      router.refresh()
      return
    }

    const code: string | undefined = payload.error?.code
    const message: string = payload.error?.message || '구매 처리에 실패했습니다.'

    if (response.status === 401) {
      setCheckout(null)
      redirectToLogin()
      return
    }

    // 네트워크 유실·5xx(재시도 소진, 일시 중지 포함)는 같은 키로 다시 시도한다.
    if (response.status >= 500) {
      setCheckout({ ...request, submitting: false, retryable: true, notice: `${message} 다시 시도하면 같은 요청으로 처리됩니다.` })
      return
    }

    // 402: 사전 확인은 부족액을 주고, 차감 단계(P0402)는 주지 않으므로 잔액을 다시 읽어 계산한다.
    if (response.status === 402) {
      let balance = typeof payload.details?.balance === 'number' ? payload.details.balance : request.balance
      let shortfall: number
      if (typeof payload.details?.shortfall === 'number') {
        shortfall = payload.details.shortfall
      } else {
        balance = await fetchBalance().catch(() => balance)
        shortfall = sumCredits(request.lines) - balance
      }
      setCheckout({
        ...request,
        submitting: false,
        retryable: false,
        balance,
        shortfall: shortfall > 0 ? shortfall : null,
        notice: shortfall > 0
          ? '보유 크레딧이 부족해 구매하지 못했습니다. 크레딧을 충전한 뒤 다시 구매해주세요.'
          : '보유 크레딧이 변경되었습니다. 금액을 확인한 뒤 다시 구매해주세요.',
      })
      return
    }

    if (code === 'PRICE_CHANGED') {
      const latest = new Map<string, PriceChangedItem>(
        ((payload.details?.items ?? []) as PriceChangedItem[]).map((item) => [`${item.targetKind}:${item.targetId}`, item])
      )
      const lines = request.lines.flatMap((line) => {
        const item = latest.get(line.key)
        if (!item || !item.purchasable || item.chargedCredits === null) {
          return []
        }
        return [item.chargedCredits === line.expectedCredits
          ? line
          : { ...line, expectedCredits: item.chargedCredits, previousCredits: line.expectedCredits }]
      })
      const removedCount = request.lines.length - lines.length

      if (lines.length === 0) {
        setCheckout(null)
        toast.error('선택한 자료를 모두 구매할 수 없게 되었습니다. 최신 정보를 확인해주세요.')
        clearSelection()
        router.refresh()
        return
      }
      setCheckout({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        lines,
        submitting: false,
        retryable: false,
        notice: removedCount > 0
          ? `판매 상태가 바뀐 자료 ${removedCount}건을 제외하고 변경된 금액으로 다시 표시했습니다. 확인 후 구매해주세요.`
          : '가격이 변경되었습니다. 변경된 금액을 확인한 뒤 다시 구매해주세요.',
      })
      return
    }

    if (code === 'ACK_REQUIRED') {
      const ackKeys = new Set(((payload.details?.lines ?? []) as { targetKind: string; targetId: string }[])
        .map((line) => `${line.targetKind}:${line.targetId}`))
      setCheckout({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        lines: request.lines.map((line) => (ackKeys.has(line.key) ? { ...line, partiallyOwned: true } : line)),
        acknowledged: false,
        submitting: false,
        retryable: false,
        notice: message,
      })
      return
    }

    // ALREADY_OWNED·CONFLICTING_SELECTION·NOT_FOUND·IDEMPOTENCY_CONFLICT·422: 최신 상태를 보고 다시 고른다.
    setCheckout(null)
    toast.error(message)
    clearSelection()
    router.refresh()
  }

  const checkoutTotal = checkout ? sumCredits(checkout.lines) : 0
  const needsAcknowledgement = checkout?.lines.some((line) => line.partiallyOwned) ?? false

  const openSamplePreview = () => {
    setIsSamplePreviewOpen(true)
  }

  const prefetchSamplePreview = () => {
    if (!hasSamplePages) {
      return
    }

    setSamplePreviewPrefetchKey((value) => value + 1)
  }

  const getOptionState = (key: string, owned: boolean): OptionState => {
    if (owned) return 'owned'
    if (selectedKeySet.has(key) && checkout?.submitting) return 'processing'
    if (selectedKeySet.has(key) && isCheckingBalance) return 'checking'
    return 'available'
  }

  const renderOptionSelectControl = (key: string) => {
    const option = optionByKey.get(key)
    if (!option) {
      return null
    }
    const reason = getBlockedReason(option)
    const reasonId = `${selectionIdPrefix}-${option.key}`

    return (
      <div className="flex w-full flex-col items-start gap-1">
        <label className="-ml-3 flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--studio-ink)] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-[var(--studio-muted)]">
          <span className="grid size-11 shrink-0 place-items-center">
            <Checkbox
              checked={selectedKeySet.has(option.key)}
              disabled={reason !== null || isBusy}
              onCheckedChange={(checked) => toggleOption(option.key, checked === true)}
              aria-label={`${option.title} 선택`}
              aria-describedby={reason ? reasonId : undefined}
            />
          </span>
          선택
        </label>
        {reason ? (
          <p id={reasonId} className="break-keep text-left text-xs leading-5 text-[var(--studio-muted)]">{reason}</p>
        ) : null}
      </div>
    )
  }

  // 비로그인은 선택 건수와 무관하게 버튼을 눌러 로그인으로 이동한다(로그인 후 이 상세로 복귀).
  const summaryHintId = !isLoggedIn
    ? `${selectionIdPrefix}-login`
    : selectedOptions.length === 0 ? `${selectionIdPrefix}-empty` : undefined

  const renderV2PurchaseOptions = () => {
    const filesBySubproduct = new Map<string, MarketSubproductDownloadFile[]>()
    for (const file of downloadFiles) {
      const current = filesBySubproduct.get(file.subproductId) ?? []
      current.push(file)
      filesBySubproduct.set(file.subproductId, current)
    }

    // 문제(PDF)의 PDF와 문제(HWP)에 포함된 PDF는 동일 내용이므로, 전자가 보이면 후자를 숨긴다.
    // 카테고리 매핑 실패(비활성 서브상품 등) 시에는 숨기지 않는 방향으로만 퇴화한다(fail-safe).
    const categorySlugBySubproductId = new Map(subproducts.map((subproduct) => [subproduct.id, subproduct.categorySlug]))
    const dedupeQuestionPdfFiles = (files: MarketSubproductDownloadFile[]) => {
      const hasQuestionPdfPdf = files.some((file) => (
        categorySlugBySubproductId.get(file.subproductId) === 'question_pdf'
        && file.fileTypeCode.toLowerCase() === 'pdf'
      ))
      if (!hasQuestionPdfPdf) return files
      return files.filter((file) => !(
        categorySlugBySubproductId.get(file.subproductId) === 'question_hwp'
        && file.fileTypeCode.toLowerCase() === 'pdf'
      ))
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
                <a href={buildV2DownloadUrl(itemId, file.id)} aria-label={`${downloadLabel} 다운로드`}>
                  <FileTypeDocIcon code={file.fileTypeCode} />
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
              {!bundleOption.owned ? (
                <div className="mb-2">{renderOptionSelectControl(`bundle:${bundleOption.id}`)}</div>
              ) : null}
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
                    {!bundleOption.owned && isPartiallyOwnedBundle ? (
                      <p className="mt-2 text-xs leading-5 text-slate-600">이미 구매한 개별 자료가 있어도 기보유분 차감 없이 정가로 구매됩니다.</p>
                    ) : null}
                  </div>
                </div>
                <OptionStateBadge state={getOptionState(`bundle:${bundleOption.id}`, bundleOption.owned)} />
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
                          <FileTypeBadges subproduct={subproduct} siblings={subproducts} />
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
                {bundleOption.owned ? renderDownloadButtons(dedupeQuestionPdfFiles(downloadFiles)) : null}
              </div>
            </div>
          </section>
        ) : null}

        {/* 전체 패키지 소유 시 개별 구매 섹션은 패키지 영역과 완전히 중복되므로 숨긴다 */}
        {subproducts.length > 0 && !bundleOption?.owned ? (
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
                if (subproduct.categorySlug === 'question_pdf' && hasOwnedPdfInclusiveHwp) {
                  return null
                }

                const ownedFiles = filesBySubproduct.get(subproduct.id) ?? []
                const fileTypeLabels = subproduct.fileTypes.map((fileType) => fileType.label).join(' · ') || '파일'
                const iconKind = getSubproductIconKind(subproduct)
                const isBundleIncluded = Boolean(bundleOption?.owned && !subproduct.owned)
                const isDownloadable = subproduct.owned || Boolean(bundleOption?.owned)
                const isUpgradePricing = !isDownloadable && subproduct.upgradePriceCredits != null
                const effectivePriceCredits = isUpgradePricing
                  ? subproduct.upgradePriceCredits!
                  : subproduct.priceCredits
                const subproductState = isBundleIncluded
                  ? 'included'
                  : getOptionState(`subproduct:${subproduct.id}`, subproduct.owned)

                return (
                  <FileOptionRow
                    key={subproduct.id}
                    title={subproduct.title}
                    description={subproduct.description || `${subproduct.categoryName} · ${fileTypeLabels}`}
                    priceLabel={`${formatCredits(effectivePriceCredits)} 크레딧`}
                    priceCaption={isUpgradePricing
                      ? `차액 업그레이드 (정가 ${formatCredits(subproduct.priceCredits)} 크레딧)`
                      : '개별가'}
                    state={subproductState}
                    icon={<MarketOptionIcon kind={iconKind} />}
                    actionLabel={isDownloadable ? '다운로드' : '선택'}
                    actionIcon={isDownloadable ? <Download className="h-4 w-4" /> : undefined}
                    buttonClassName={MARKET_OUTLINE_BUTTON_CLASS}
                    actionSlot={isDownloadable ? renderDownloadButtons(ownedFiles) : undefined}
                    selectSlot={isDownloadable ? undefined : renderOptionSelectControl(`subproduct:${subproduct.id}`)}
                    showDefaultAction={isDownloadable}
                    meta={<FileTypeBadges subproduct={subproduct} />}
                    notice={resolveSubproductPurchaseNotice(subproduct)}
                    className="rounded-xl border-slate-200 p-3 shadow-none"
                  />
                )
              })}
            </div>
          </section>
        ) : null}

        {hasSelectableOption ? (
          <section aria-label="선택한 옵션 합계" className="border-t border-[var(--studio-border)] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-semibold text-[var(--studio-text)]">선택 {selectedOptions.length}건</p>
              <p className="flex items-baseline gap-2">
                <span className="text-sm text-[var(--studio-muted)]">총 금액</span>
                <span className="text-lg font-extrabold text-[var(--studio-ink)]">{formatCredits(selectedTotal)} 크레딧</span>
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="brandOutline"
                className="h-auto min-h-11 w-full whitespace-normal"
                disabled={(isLoggedIn && selectedOptions.length === 0) || isBusy}
                aria-describedby={summaryHintId}
                onClick={() => void addSelectedToCart()}
              >
                <ShoppingCart aria-hidden="true" className="h-4 w-4" />
                {!isLoggedIn ? '로그인 후 담기' : isAddingToCart ? '담는 중' : '장바구니'}
              </Button>
              <Button
                variant="brand"
                className="h-auto min-h-11 w-full whitespace-normal"
                disabled={(isLoggedIn && selectedOptions.length === 0) || isBusy}
                aria-describedby={summaryHintId}
                onClick={() => void openCheckout()}
              >
                {isLoggedIn ? '구매하기' : '로그인 후 구매'}
              </Button>
            </div>
            {!isLoggedIn ? (
              <p id={`${selectionIdPrefix}-login`} aria-live="polite" className={emptyNotice ? 'mt-2 text-xs font-semibold text-[var(--studio-ink)]' : 'mt-2 text-xs text-[var(--studio-muted)]'}>
                {emptyNotice ? '담을 자료를 먼저 선택하세요.' : '자료를 선택한 뒤 담기·구매하면 로그인 후 이 페이지로 돌아옵니다.'}
              </p>
            ) : selectedOptions.length === 0 ? (
              <p id={`${selectionIdPrefix}-empty`} className="mt-2 text-xs text-[var(--studio-muted)]">구매하거나 담을 옵션을 선택하세요.</p>
            ) : null}
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

      {/* legacy 구매는 종료(410)되어 구매 버튼을 숨기고, 기존 구매자의 다운로드만 유지한다 */}
      {ownsPdf ? (
        <FileOptionRow
          title="PDF"
          description="구매 완료된 PDF 파일입니다."
          priceLabel={`${formatCredits(pdfPrice)} 크레딧`}
          state="owned"
          icon={<MarketOptionIcon kind="default" />}
          actionLabel="PDF 다운로드"
          actionIcon={<FileTypeDocIcon code="pdf" />}
          href={buildDownloadUrl(itemId, 'pdf')}
          buttonClassName={MARKET_DOWNLOAD_BUTTON_CLASS}
        />
      ) : null}

      {ownsHwp ? (
        <FileOptionRow
          title="HWP & PDF"
          description="구매 완료된 HWP & PDF 묶음입니다."
          priceLabel={`${formatCredits(hwpPrice)} 크레딧`}
          state="owned"
          icon={<MarketOptionIcon kind="default" />}
          actionLabel="HWP 다운로드"
          actionIcon={<FileTypeDocIcon code="hwp" />}
          href={buildDownloadUrl(itemId, 'hwp')}
          buttonClassName={MARKET_DOWNLOAD_BUTTON_CLASS}
        />
      ) : null}
      {ownsZip ? (
        <FileOptionRow
          title="ZIP"
          description="구매 완료된 ZIP 파일입니다."
          priceLabel={`${formatCredits(zipPrice)} 크레딧`}
          state="owned"
          icon={<MarketOptionIcon kind="default" />}
          actionLabel="ZIP 다운로드"
          actionIcon={<FileTypeDocIcon code="zip" />}
          href={buildDownloadUrl(itemId, 'zip')}
          buttonClassName={MARKET_DOWNLOAD_BUTTON_CLASS}
        />
      ) : null}
        </>
      )}

      <div className="rounded-2xl border border-dashed bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        구매 후 바로 다운로드할 수 있으며, 구매한 파일은 <span className="font-semibold text-slate-700">{libraryPurchaseLabel}</span>에서도 확인할 수 있습니다.
      </div>

      <MarketCheckoutConfirmDialog
        open={checkout !== null}
        title="문제마켓 구매 확인"
        description="크레딧으로 선택한 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다."
        lines={(checkout?.lines ?? []).map((line) => ({
          key: line.key,
          title: line.title,
          optionTitle: null,
          expectedCredits: line.expectedCredits,
          previousCredits: line.previousCredits,
        }))}
        total={checkoutTotal}
        balance={checkout?.balance ?? 0}
        needsAcknowledgement={needsAcknowledgement}
        acknowledged={checkout?.acknowledged ?? false}
        onAcknowledgedChange={(acknowledged) => checkout && setCheckout({ ...checkout, acknowledged })}
        notice={checkout?.notice ?? null}
        shortfall={checkout?.shortfall ?? null}
        chargeHref="/pricing"
        submitting={checkout?.submitting ?? false}
        retryable={checkout?.retryable ?? false}
        onCancel={() => setCheckout(null)}
        onConfirm={() => void submitCheckout()}
      />

      {/* 로그인 완료 Dialog가 닫힌(login 쿼리가 지워진) 뒤에 연다. 두 모달이 겹치지 않게 한다. */}
      <Dialog
        open={cartResult !== null && !isLoginCompletePending}
        onOpenChange={(open) => !open && setCartResult(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cartResult?.kind === 'notice' ? '장바구니 담기 안내' : '장바구니 담기'}</DialogTitle>
            <DialogDescription>{cartResult?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="brandOutline" onClick={() => setCartResult(null)}>
              {cartResult?.kind === 'notice' ? '확인' : '계속 둘러보기'}
            </Button>
            <Button asChild variant="brand">
              <Link href="/cart">장바구니 보기</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarketPurchaseCompleteDialog
        result={purchaseComplete}
        libraryHref={resolveMarketLibraryHref(purchaseComplete?.orders.map((order) => order.workspaceSubject) ?? [])}
        onClose={() => setPurchaseComplete(null)}
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
