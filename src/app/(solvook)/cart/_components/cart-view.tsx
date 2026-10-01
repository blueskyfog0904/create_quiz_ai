'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShoppingCart, X } from 'lucide-react'
import { toast } from 'sonner'
import { StudioContainer, StudioEmptyState } from '@/components/design-system'
import { dispatchMarketCartUpdated } from '@/components/market/market-cart-indicator'
import { MarketCheckoutConfirmDialog } from '@/components/market/market-checkout-confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import type { MarketCartItem, MarketCartView } from '@/lib/market-cart-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface CartViewProps {
  initialView: MarketCartView
}

interface CheckoutLine {
  cartItemId: string
  title: string
  optionTitle: string | null
  expectedCredits: number
  // 409 PRICE_CHANGED로 바뀐 경우 직전에 확인했던 금액
  previousCredits: number | null
  partiallyOwned: boolean
}

interface CheckoutState {
  // Dialog를 열 때 1개 생성. 확정·재시도는 같은 키, 409 재확인은 새 키(6절).
  idempotencyKey: string
  lines: CheckoutLine[]
  balance: number
  acknowledged: boolean
  submitting: boolean
  retryable: boolean
  notice: string | null
  shortfall: number | null
}

interface PriceChangedItem {
  cartItemId: string
  purchasable: boolean
  chargedCredits: number | null
}

const SUBJECT_GROUPS: { subject: WorkspaceSubject | null; label: string }[] = [
  { subject: 'korean', label: '국어' },
  { subject: 'english', label: '영어' },
  { subject: null, label: '판매 종료' },
]

const ROW_CHECKBOX_LABEL_CLASS = 'grid size-11 shrink-0 cursor-pointer place-items-center rounded-md has-[:disabled]:cursor-not-allowed'

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
}

function getItemTitle(item: MarketCartItem) {
  return item.itemTitle ?? '판매가 종료된 자료'
}

function getUnavailableReason(item: MarketCartItem) {
  if (item.reason === 'ALREADY_OWNED') {
    return '이미 보유한 자료입니다. 자료 보관함에서 받을 수 있어요.'
  }
  if (item.reason) {
    return '현재 판매하지 않는 자료라 구매할 수 없습니다.'
  }
  return null
}

function sumCredits(lines: { expectedCredits: number }[]) {
  return lines.reduce((total, line) => total + line.expectedCredits, 0)
}

export function CartView({ initialView }: CartViewProps) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [isMutating, setIsMutating] = useState(false)
  const [checkout, setCheckout] = useState<CheckoutState | null>(null)

  const selectableItems = view.items.filter((item) => item.purchasable)
  const selectedItems = selectableItems.filter((item) => item.isSelected)
  const allSelected = selectableItems.length > 0 && selectedItems.length === selectableItems.length
  const selectedTotal = selectedItems.reduce((total, item) => total + (item.chargedCredits ?? 0), 0)

  const reload = async (): Promise<MarketCartView | null> => {
    try {
      const response = await fetch('/api/market/cart', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message)
      }
      setView(payload.data)
      dispatchMarketCartUpdated(payload.data.count)
      return payload.data
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : '장바구니를 다시 불러오지 못했습니다.')
      return null
    }
  }

  const updateSelection = async (ids: string[], isSelected: boolean) => {
    const idSet = new Set(ids)
    setView((current) => ({
      ...current,
      items: current.items.map((item) => (idSet.has(item.id) ? { ...item, isSelected } : item)),
    }))
    setIsMutating(true)
    try {
      const response = await fetch('/api/market/cart/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, isSelected }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        toast.error(payload.error?.message || '선택 상태를 저장하지 못했습니다.')
        await reload()
      } else if (payload.data.missingIds.length > 0) {
        await reload()
      }
    } catch {
      toast.error('네트워크 오류로 선택 상태를 저장하지 못했습니다.')
      await reload()
    } finally {
      setIsMutating(false)
    }
  }

  const removeItems = async (ids: string[]) => {
    setIsMutating(true)
    try {
      const response = await fetch('/api/market/cart/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.success) {
        toast.error(payload.error?.message || '장바구니에서 삭제하지 못했습니다.')
      }
    } catch {
      toast.error('네트워크 오류로 장바구니에서 삭제하지 못했습니다.')
    } finally {
      await reload()
      setIsMutating(false)
    }
  }

  const openCheckout = () => {
    if (selectedItems.length === 0) {
      return
    }

    setCheckout({
      idempotencyKey: crypto.randomUUID(),
      lines: selectedItems.map((item) => ({
        cartItemId: item.id,
        title: getItemTitle(item),
        optionTitle: item.optionTitle,
        expectedCredits: item.chargedCredits ?? 0,
        previousCredits: null,
        partiallyOwned: item.partiallyOwned,
      })),
      balance: view.balance,
      acknowledged: false,
      submitting: false,
      retryable: false,
      notice: null,
      shortfall: null,
    })
  }

  const submitCheckout = async () => {
    if (!checkout || checkout.submitting) {
      return
    }

    const request = checkout
    setCheckout({ ...request, submitting: true })

    let response: Response
    try {
      response = await fetch('/api/market/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: request.lines.map((line) => ({
            cartItemId: line.cartItemId,
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
      toast.success(payload.message || '선택한 자료 구매가 완료되었습니다.', {
        action: { label: '자료 보관함', onClick: () => router.push('/library') },
      })
      await reload()
      return
    }

    const code: string | undefined = payload.error?.code
    const message: string = payload.error?.message || '구매 처리에 실패했습니다.'

    if (response.status === 401) {
      router.push(buildAuthRedirectPath('/cart'))
      return
    }

    // 네트워크 유실·5xx(재시도 소진, 일시 중지 포함)는 같은 키로 다시 시도한다.
    if (response.status >= 500) {
      setCheckout({ ...request, submitting: false, retryable: true, notice: `${message} 다시 시도하면 같은 요청으로 처리됩니다.` })
      return
    }

    // 402는 사전 확인·차감 단계 어느 쪽이든 최신 잔액과 선택 합계로 부족액을 다시 계산한다.
    if (response.status === 402) {
      const latestView = await reload()
      const balance = typeof payload.details?.availableCredits === 'number'
        ? payload.details.availableCredits
        : latestView?.balance ?? request.balance
      const required = typeof payload.details?.requiredCredits === 'number'
        ? payload.details.requiredCredits
        : sumCredits(request.lines)
      const shortfall = required - balance
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
        ((payload.details?.items ?? []) as PriceChangedItem[]).map((item) => [item.cartItemId, item])
      )
      const lines = request.lines.flatMap((line) => {
        const item = latest.get(line.cartItemId)
        if (!item || !item.purchasable || item.chargedCredits === null) {
          return []
        }
        return [item.chargedCredits === line.expectedCredits
          ? line
          : { ...line, expectedCredits: item.chargedCredits, previousCredits: line.expectedCredits }]
      })
      const removedCount = request.lines.length - lines.length

      const latestView = await reload()
      if (lines.length === 0) {
        setCheckout(null)
        toast.error('선택한 자료를 모두 구매할 수 없게 되었습니다. 장바구니를 확인해주세요.')
        return
      }
      setCheckout({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        lines,
        balance: latestView?.balance ?? request.balance,
        submitting: false,
        retryable: false,
        notice: removedCount > 0
          ? `판매 상태가 바뀐 자료 ${removedCount}건을 제외하고 변경된 금액으로 다시 표시했습니다. 확인 후 구매해주세요.`
          : '가격이 변경되었습니다. 변경된 금액을 확인한 뒤 다시 구매해주세요.',
      })
      return
    }

    if (code === 'ACK_REQUIRED') {
      const ackIds = new Set(((payload.details?.lines ?? []) as { cartItemId: string }[]).map((line) => line.cartItemId))
      setCheckout({
        ...request,
        idempotencyKey: crypto.randomUUID(),
        lines: request.lines.map((line) => (ackIds.has(line.cartItemId) ? { ...line, partiallyOwned: true } : line)),
        acknowledged: false,
        submitting: false,
        retryable: false,
        notice: message,
      })
      return
    }

    // CART_CHANGED·ALREADY_OWNED·CONFLICTING_SELECTION·IDEMPOTENCY_CONFLICT 등: 목록을 새로 보고 다시 고른다.
    setCheckout(null)
    toast.error(message)
    await reload()
  }

  const checkoutTotal = checkout ? sumCredits(checkout.lines) : 0
  const needsAcknowledgement = checkout?.lines.some((line) => line.partiallyOwned) ?? false

  const renderItem = (item: MarketCartItem) => {
    const title = getItemTitle(item)
    const unavailableReason = getUnavailableReason(item)
    const isUpgradePrice = item.chargedCredits !== null && item.originalCredits !== null && item.chargedCredits < item.originalCredits

    return (
      <li key={item.id} className="flex items-start gap-2 py-4 sm:gap-3">
        <label className={ROW_CHECKBOX_LABEL_CLASS}>
          <Checkbox
            checked={item.purchasable && item.isSelected}
            disabled={!item.purchasable || isMutating}
            onCheckedChange={(checked) => void updateSelection([item.id], checked === true)}
            aria-label={`${title} 선택`}
          />
        </label>
        <div className="min-w-0 flex-1 py-1">
          <p className="text-xs font-semibold text-[var(--studio-muted)]">
            {item.categoryName ?? (item.targetKind === 'bundle' ? '전체 패키지' : '개별 자료')}
          </p>
          <p className="mt-1 break-keep font-bold leading-6 text-[var(--studio-ink)]">
            {item.detailHref ? (
              <Link
                href={item.detailHref}
                className="rounded-sm outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                {title}
              </Link>
            ) : title}
          </p>
          {item.optionTitle ? (
            <p className="mt-0.5 break-keep text-sm text-[var(--studio-text)]">{item.optionTitle}</p>
          ) : null}
          {unavailableReason ? (
            <p className="mt-2 text-xs font-medium text-destructive">{unavailableReason}</p>
          ) : null}
          {item.purchasable && item.partiallyOwned ? (
            <p className="mt-2 text-xs text-[var(--studio-muted)]">이미 구매한 개별 자료가 있어도 기보유분 차감 없이 정가로 구매됩니다.</p>
          ) : null}
          {item.purchasable && isUpgradePrice ? (
            <p className="mt-2 text-xs text-[var(--studio-muted)]">보유한 자료 가격을 뺀 차액으로 구매합니다.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void removeItems([item.id])}
            disabled={isMutating}
            aria-label={`${title} 삭제`}
            className="grid size-11 place-items-center rounded-md text-[var(--studio-muted)] outline-none hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
          {item.chargedCredits !== null ? (
            <div className="text-right">
              {isUpgradePrice ? (
                <p className="text-xs text-[var(--studio-muted)] line-through">{formatCredits(item.originalCredits ?? 0)}</p>
              ) : null}
              <p className="whitespace-nowrap font-bold text-[var(--studio-ink)]">{formatCredits(item.chargedCredits)} 크레딧</p>
            </div>
          ) : null}
        </div>
      </li>
    )
  }

  const purchaseButtonLabel = selectedItems.length > 0
    ? `선택 자료 ${selectedItems.length}건 구매`
    : '구매할 자료를 선택하세요'

  return (
    <StudioContainer className="pb-40 pt-8 sm:pt-10 lg:pb-16">
      <div className="flex flex-wrap items-end gap-2">
        <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">장바구니</h1>
        <p className="pb-1 text-sm text-[var(--studio-muted)]">{view.count}/50</p>
      </div>

      {view.items.length === 0 ? (
        <div className="mt-8">
          <StudioEmptyState
            icon={<ShoppingCart aria-hidden="true" className="h-5 w-5" />}
            title="장바구니가 비어 있습니다"
            description="문제마켓 상세 화면에서 필요한 자료를 장바구니에 담아 보세요."
            action={(
              <Button asChild variant="brand">
                <Link href="/">자료 둘러보기</Link>
              </Button>
            )}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-ink)] pb-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--studio-ink)]">
                <span className="grid size-11 place-items-center">
                  <Checkbox
                    checked={allSelected}
                    disabled={selectableItems.length === 0 || isMutating}
                    onCheckedChange={() => void updateSelection(selectableItems.map((item) => item.id), !allSelected)}
                    aria-label="구매 가능한 자료 전체 선택"
                  />
                </span>
                전체 선택 ({selectedItems.length}/{selectableItems.length})
              </label>
              <Button
                variant="brandGhost"
                disabled={selectedItems.length === 0 || isMutating}
                onClick={() => void removeItems(selectedItems.map((item) => item.id))}
              >
                선택 삭제
              </Button>
            </div>

            {SUBJECT_GROUPS.map((group) => {
              const items = view.items.filter((item) => item.workspaceSubject === group.subject)
              if (items.length === 0) {
                return null
              }
              return (
                <section key={group.label} aria-label={`${group.label} 자료`} className="mt-4">
                  <h2 className="text-sm font-extrabold text-[var(--studio-ink)]">
                    {group.label} <span className="font-semibold text-[var(--studio-muted)]">{items.length}</span>
                  </h2>
                  <ul className="divide-y divide-[var(--studio-border)] border-b border-[var(--studio-border)]">
                    {items.map(renderItem)}
                  </ul>
                </section>
              )
            })}
          </div>

          <aside aria-label="선택 자료 요약" className="hidden lg:block">
            <div className="sticky top-32 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)]">
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--studio-muted)]">선택 자료</dt>
                  <dd className="font-semibold text-[var(--studio-ink)]">{selectedItems.length}건</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-[var(--studio-muted)]">보유 크레딧</dt>
                  <dd className="font-semibold text-[var(--studio-ink)]">{formatCredits(view.balance)} 크레딧</dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-[var(--studio-border)] pt-3">
                  <dt className="font-bold text-[var(--studio-ink)]">합계</dt>
                  <dd className="text-lg font-extrabold text-[var(--studio-primary)]">{formatCredits(selectedTotal)} 크레딧</dd>
                </div>
              </dl>
              <Button
                variant="brand"
                className="mt-5 w-full"
                disabled={selectedItems.length === 0 || isMutating}
                onClick={openCheckout}
              >
                {purchaseButtonLabel}
              </Button>
            </div>
          </aside>
        </div>
      )}

      {view.items.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--studio-border)] bg-[var(--studio-surface)] pb-[env(safe-area-inset-bottom)] lg:hidden">
          <StudioContainer className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-xs text-[var(--studio-muted)]">
                선택 {selectedItems.length}건 · 보유 {formatCredits(view.balance)}
              </p>
              <p className="font-extrabold text-[var(--studio-primary)]">{formatCredits(selectedTotal)} 크레딧</p>
            </div>
            <Button
              variant="brand"
              className="shrink-0"
              disabled={selectedItems.length === 0 || isMutating}
              onClick={openCheckout}
            >
              {selectedItems.length > 0 ? `${selectedItems.length}건 구매` : '자료 선택'}
            </Button>
          </StudioContainer>
        </div>
      ) : null}

      <MarketCheckoutConfirmDialog
        open={checkout !== null}
        title="선택 자료 구매 확인"
        description="크레딧으로 아래 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다."
        lines={(checkout?.lines ?? []).map((line) => ({
          key: line.cartItemId,
          title: line.title,
          optionTitle: line.optionTitle,
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
        chargeHint="충전 후 장바구니로 돌아오면 담아 둔 자료가 그대로 남아 있습니다."
        submitting={checkout?.submitting ?? false}
        retryable={checkout?.retryable ?? false}
        onCancel={() => setCheckout(null)}
        onConfirm={() => void submitCheckout()}
      />
    </StudioContainer>
  )
}
