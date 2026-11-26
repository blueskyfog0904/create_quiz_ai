'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { dispatchMarketCartUpdated } from '@/components/market/market-cart-indicator'
import {
  MarketPurchaseCompleteDialog,
  resolveMarketLibraryHref,
  type MarketPurchaseCompleteResult,
} from '@/components/market/market-purchase-complete-dialog'
import { canRenderCheckoutConsent, type CheckoutConsentLinks } from '@/components/checkout/checkout-consent'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import type { MarketCartItem, MarketCartView } from '@/lib/market-cart-server'
import { redirectToConsentIfRequired } from '@/lib/consent-client'
import {
  checkoutPanelMaxInnerHeight,
  CHECKOUT_PANEL_STICKY_TOP,
  decideCheckoutPanelMode,
  type CheckoutPanelMode,
} from '@/lib/checkout-panel-layout'
import {
  buildAmountLine,
  buildCheckoutRequest,
  buildOrderKey,
  buildPartialKey,
  classifyReceiptLookup,
  clearConsentAfterSuccess,
  conflictingLineIds,
  decideCheckoutButton,
  dequeueComplete,
  enqueueComplete,
  initialConsentState,
  isConsentComplete,
  noticeCopyFromView,
  noticeCopyIdentity,
  reconcileAnnouncement,
  reconcileConsent,
  viewWithNoticeCopy,
  reduceCheckoutResponse,
  selectedLines,
  shouldRecheckAfterReload,
  type CartConsentInput,
  type CartConsentState,
  type CheckoutFocusTarget,
  type CheckoutReceiptData,
  type CheckoutRequestBody,
} from '@/lib/cart-checkout-panel'
import { CartLineListView, getCartItemTitle } from './cart-line-list-view'
import { CartCheckoutPanelView } from './cart-checkout-panel-view'
import { CART_BAR_HEIGHT, CartCheckoutBar, CartPageView } from './cart-page-view'

// 11번 6-1 껍데기: 뷰 읽기, 결제 요청, 키·스냅숏, 선택 저장, 동의 수명, 알림·토스트. 그리기는 표시 부품(cart-*-view.tsx)이 한다.
// 동의 문구·장바구니 문구는 모두 DB 값(purchaseConsent·purchaseNotice·cartTexts)이고 화면은 지문을 계산하지 않는다.

interface CartViewProps {
  initialView: MarketCartView
  // 변경 예정 약관 한 줄 안내(서버 부품, 15번 6-2). 구매 고지 문구는 바꾸지 않는다.
  upcomingNotice?: ReactNode
}

type AnnounceOrigin = 'panel' | 'list' | 'silent'

const CHARGE_HREF = '/pricing'
const LG_QUERY = '(min-width: 1024px)'

function withForcedPartial(items: MarketCartItem[], forced: readonly string[]): MarketCartItem[] {
  if (forced.length === 0) return items
  return items.map((item) => (forced.includes(item.id) ? { ...item, partiallyOwned: true } : item))
}

function consentInputFrom(view: MarketCartView, items: MarketCartItem[]): CartConsentInput {
  const lines = selectedLines(items)
  return {
    noticeCopy: noticeCopyFromView(view),
    cartTexts: view.cartTexts,
    orderKey: buildOrderKey(lines),
    partialKey: buildPartialKey(lines),
  }
}

function sumCredits(lines: { chargedCredits: number | null }[]) {
  return lines.reduce((total, line) => total + (line.chargedCredits ?? 0), 0)
}

export function CartView({ initialView, upcomingNotice }: CartViewProps) {
  const router = useRouter()
  const [view, setView] = useState(initialView)
  const [forcedPartialIds, setForcedPartialIds] = useState<string[]>([])
  const [previousCredits, setPreviousCredits] = useState<Record<string, number>>({})
  const [serverConflictItemIds, setServerConflictItemIds] = useState<string[]>([])
  const [isMutating, setIsMutating] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // retryable 동안만 값이 있다(같은 키·같은 본문으로 다시 보냄). 그 밖의 응답은 모두 버린다.
  const [snapshot, setSnapshot] = useState<CheckoutRequestBody | null>(null)
  const [consent, setConsentState] = useState<CartConsentState>(() => initialConsentState(consentInputFrom(initialView, initialView.items)))
  const [statusText, setStatusText] = useState('')
  const [alertText, setAlertText] = useState('')
  const [completeQueue, setCompleteQueue] = useState<MarketPurchaseCompleteResult[]>([])
  const [mode, setMode] = useState<CheckoutPanelMode>('flow')
  const [barObserved, setBarVisible] = useState(false)

  const consentRef = useRef(consent)
  const forcedRef = useRef(forcedPartialIds)
  const modeRef = useRef(mode)
  const inFlightRef = useRef(false)
  // [다시 선택] 404 뒤 기억한 직전 키와 줄 묶음(한 번 더 조회)
  const rememberedRef = useRef<{ key: string; lineIds: string[] } | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const topRef = useRef<HTMLDivElement | null>(null)
  const alertsRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const buttonRowRef = useRef<HTMLDivElement | null>(null)
  const primaryRef = useRef<HTMLElement | null>(null)
  const partialAckRef = useRef<HTMLButtonElement | null>(null)

  const setConsent = (next: CartConsentState) => {
    consentRef.current = next
    setConsentState(next)
  }

  const items = withForcedPartial(view.items, forcedPartialIds)
  const selectableItems = items.filter((item) => item.purchasable)
  const lines = selectedLines(items)
  const allSelected = selectableItems.length > 0 && lines.length === selectableItems.length
  const total = sumCredits(lines)
  const conflictIds = conflictingLineIds(lines)
  for (const line of lines) {
    if (line.itemId && serverConflictItemIds.includes(line.itemId)) conflictIds.add(line.id)
  }
  const links: CheckoutConsentLinks = {
    refundPolicy: view.refundPolicyLink?.href ?? null,
    serviceTerms: view.termsLink?.href ?? null,
  }
  const noticeCopy = consent.noticeCopy
  const noticeAvailable = noticeCopy !== null && consent.cartTexts !== null
    && (noticeCopy.format === 1 || canRenderCheckoutConsent(noticeCopy.consent, links))
  const needsPartialAck = lines.some((line) => line.partiallyOwned)

  const decision = decideCheckoutButton({
    submitting,
    reloading,
    saving: isMutating,
    reloadFailed,
    retryable: snapshot !== null,
    selectedCount: lines.length,
    noticeAvailable,
    hasConflict: conflictIds.size > 0,
    total,
    balance: view.balance,
    needsPartialAck,
    partialAck: consent.partialAck,
    consentComplete: isConsentComplete(noticeCopy, consent.checkedKeys),
  })
  const listLocked = decision.locked || isMutating || submitting

  // ── 알림: 위 영역 맨 위 두 요소의 글만 바꾼다. 초점은 옮기지 않는다. ─────────────────────────────
  const announce = (text: string, kind: 'status' | 'alert', origin: AnnounceOrigin) => {
    setStatusText(kind === 'status' ? text : '')
    setAlertText(kind === 'alert' ? text : '')
    if (!text || origin === 'silent') return
    window.requestAnimationFrame(() => {
      if (modeRef.current === 'sticky') {
        if (topRef.current) topRef.current.scrollTop = 0
        return
      }
      // 보통 흐름: 결제 칸 안 조작·응답으로 생긴 알림만, 알림 자리가 보기 영역 밖이면 화면 안으로(scroll-padding 을 지킴).
      if (origin !== 'panel') return
      const alerts = alertsRef.current
      if (!alerts) return
      const rect = alerts.getBoundingClientRect()
      if (rect.top < CHECKOUT_PANEL_STICKY_TOP || rect.bottom > window.innerHeight) {
        alerts.scrollIntoView({ block: 'nearest' })
      }
    })
  }

  // ── 뷰 반영 + 동의 수명 맞추기(6-4) ─────────────────────────────────────────────────────────────
  // responseAlert: 결제 응답의 이유를 방금 띄웠으면 그 글. 다시 읽기의 안내가 그 이유를 덮지 않게 한다.
  const applyView = (nextView: MarketCartView, origin: AnnounceOrigin, forced: string[] = forcedRef.current, responseAlert: string | null = null) => {
    setView(nextView)
    const result = reconcileConsent(consentRef.current, consentInputFrom(nextView, withForcedPartial(nextView.items, forced)))
    setConsent(result.state)
    const announcement = reconcileAnnouncement(result, responseAlert)
    if (announcement) announce(announcement.text, announcement.kind, origin)
  }

  const lookupReceipt = async (key: string): Promise<{ status: number | null; payload: unknown }> => {
    try {
      const response = await fetch(`/api/market/cart/checkouts/${key}`, { cache: 'no-store' })
      return { status: response.status, payload: await response.json().catch(() => null) }
    } catch {
      return { status: null, payload: null }
    }
  }

  const pushComplete = (data: CheckoutReceiptData, alreadyCompleted: boolean, latestView: MarketCartView | null) => {
    setCompleteQueue((queue) => enqueueComplete(queue, {
      orders: data.orders ?? [],
      totalCredits: data.totalCredits ?? 0,
      // 잔액은 다시 읽은 뷰 값, 실패 때만 data.balanceAfter
      balance: latestView ? latestView.balance : typeof data.balanceAfter === 'number' ? data.balanceAfter : null,
      alreadyCompleted,
    }))
  }

  const recheckRemembered = async (latestView: MarketCartView | null) => {
    const remembered = rememberedRef.current
    if (!remembered) return
    rememberedRef.current = null
    const lookup = await lookupReceipt(remembered.key)
    if (classifyReceiptLookup(lookup.status, lookup.payload) === 'completed') {
      const data = (lookup.payload as { data: CheckoutReceiptData }).data
      pushComplete(data, true, latestView)
    }
  }

  const reload = async (origin: AnnounceOrigin, forced?: string[], responseAlert: string | null = null): Promise<MarketCartView | null> => {
    setReloading(true)
    let nextView: MarketCartView | null = null
    try {
      const response = await fetch('/api/market/cart', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (response.ok && payload.success) nextView = payload.data as MarketCartView
    } catch {
      nextView = null
    } finally {
      setReloading(false)
    }
    if (!nextView) {
      // 이전 화면을 두고 위 영역에 안내 + [다시 불러오기], 결제는 막는다.
      setReloadFailed(true)
      announce('장바구니를 다시 불러오지 못했습니다. [다시 불러오기]를 눌러 주세요.', 'alert', origin)
      return null
    }
    setReloadFailed(false)
    applyView(nextView, origin, forced, responseAlert)
    dispatchMarketCartUpdated(nextView.count)
    if (shouldRecheckAfterReload(rememberedRef.current, nextView.items)) await recheckRemembered(nextView)
    return nextView
  }

  // ── 목록 조작 ───────────────────────────────────────────────────────────────────────────────────
  const updateSelection = async (ids: string[], isSelected: boolean) => {
    if (listLocked) return
    // 지난 안내(status·alert)는 다음 사용자 조작 때 함께 비운다(sr-only 막힌 이유가 다시 읽히게).
    announce('', 'status', 'silent')
    const idSet = new Set(ids)
    setServerConflictItemIds([])
    applyView({
      ...view,
      items: view.items.map((item) => (idSet.has(item.id) ? { ...item, isSelected } : item)),
    }, 'list')
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
        await reload('list')
      } else if (payload.data.missingIds.length > 0) {
        await reload('list')
      }
    } catch {
      toast.error('네트워크 오류로 선택 상태를 저장하지 못했습니다.')
      await reload('list')
    } finally {
      setIsMutating(false)
    }
  }

  const removeItems = async (ids: string[]) => {
    if (listLocked) return
    // 지난 안내(status·alert)는 다음 사용자 조작 때 함께 비운다(sr-only 막힌 이유가 다시 읽히게).
    announce('', 'status', 'silent')
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
      await reload('list')
      setIsMutating(false)
    }
  }

  // ── 결제 요청 ───────────────────────────────────────────────────────────────────────────────────
  const submitCheckout = async (body: CheckoutRequestBody) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSubmitting(true)
    announce('', 'status', 'silent')
    let response: Response | null = null
    let payload: unknown = null
    try {
      response = await fetch('/api/market/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      payload = await response.json().catch(() => null)
    } catch {
      response = null
    }
    inFlightRef.current = false
    setSubmitting(false)

    // 필수 약관 동의가 필요하면 동의 화면으로 보낸다(동의 뒤 이 화면으로 돌아온다).
    if (response && redirectToConsentIfRequired(response.status, payload)) {
      setSnapshot(null)
      return
    }

    const outcome = reduceCheckoutResponse({ snapshot: body }, { status: response?.status ?? null, payload })
    const afterReselect = rememberedRef.current !== null
    if (outcome.kind === 'retryable') {
      setSnapshot(body)
      announce(outcome.message, 'alert', 'panel')
      return
    }
    // 그 밖은 모두 스냅숏을 버리고 다음 클릭에 새 키.
    setSnapshot(null)

    switch (outcome.kind) {
      case 'success': {
        rememberedRef.current = null
        setConsent(clearConsentAfterSuccess(consentRef.current))
        setPreviousCredits({})
        setServerConflictItemIds([])
        forcedRef.current = []
        setForcedPartialIds([])
        if (typeof outcome.balance === 'number') {
          window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: outcome.balance } }))
        }
        const latestView = await reload('silent', [])
        pushComplete(outcome.data, outcome.alreadyCompleted, latestView)
        // 성공 뒤에는 '주문 내용이 바뀌었습니다'를 보이지 않는다.
        announce('', 'status', 'silent')
        return
      }
      case 'login':
        router.push(buildAuthRedirectPath('/cart'))
        return
      case 'noticeChanged': {
        if (outcome.parseFailed) {
          // 해석 실패: 잠그고(고지 없음) 다시 읽는다.
          setConsent({ ...consentRef.current, noticeCopy: null, cartTexts: null, checkedKeys: [], partialAck: false })
          announce(outcome.message, 'alert', 'panel')
          await reload('panel')
          return
        }
        const current = consentRef.current
        const result = reconcileConsent(current, {
          noticeCopy: outcome.noticeCopy,
          cartTexts: outcome.cartTexts,
          orderKey: current.orderKey,
          partialKey: current.partialKey,
        })
        // 409 는 바뀐 사본을 보냈다는 뜻이므로 사본이 같아 보여도 동의를 비운다.
        setConsent({ ...result.state, checkedKeys: [] })
        // 뷰도 같은 사본으로 맞춘다(아니면 다음 줄 선택 때 옛 고지로 되돌아감).
        const copy = outcome.noticeCopy
        if (copy) setView((current) => viewWithNoticeCopy(current, copy, outcome.cartTexts))
        announce(outcome.message, 'alert', 'panel')
        return
      }
      case 'priceChanged':
        setPreviousCredits((current) => ({ ...current, ...outcome.previousCredits }))
        announce(outcome.message, 'alert', 'panel')
        await reload('silent', undefined, outcome.message)
        return
      case 'insufficient':
        announce(outcome.message, 'alert', 'panel')
        await reload('silent', undefined, outcome.message)
        return
      case 'ackRequired': {
        // 다른 탭에서 사서 뷰가 낡았어도 확인 칸이 생기게: details.lines 줄을 부분 보유로 보이게 하고 확인을 비운 뒤 초점.
        const forced = [...new Set([...forcedRef.current, ...outcome.lineIds])]
        forcedRef.current = forced
        setForcedPartialIds(forced)
        announce(outcome.message, 'alert', 'panel')
        await reload('silent', forced, outcome.message)
        setConsent({ ...consentRef.current, partialAck: false })
        window.requestAnimationFrame(() => focusTarget('partialAck'))
        return
      }
      case 'conflicting':
        setServerConflictItemIds(outcome.itemIds)
        announce(outcome.message, 'alert', 'panel')
        await reload('silent', undefined, outcome.message)
        return
      case 'reload': {
        announce(outcome.message, 'alert', 'panel')
        const latestView = await reload('silent', undefined, outcome.message)
        if (outcome.recheckReceipt && afterReselect) await recheckRemembered(latestView)
        return
      }
    }
  }

  const pay = () => {
    if (decision.state !== 'ready' || !noticeCopy || !consent.cartTexts) return
    // 직전 [다시 선택] 404 뒤 첫 결제의 결과만 재조회 대상이다.
    void submitCheckout(buildCheckoutRequest({
      lines,
      partialAck: consent.partialAck,
      noticeCopy,
      cartTexts: consent.cartTexts,
      idempotencyKey: crypto.randomUUID(),
    })).finally(() => {
      rememberedRef.current = null
    })
  }

  // [다시 선택]: 먼저 영수증 조회 → 200 완료 창, 404 스냅숏 버리고 다시 읽기, 그 밖은 retryable 유지.
  const reselect = async () => {
    if (!snapshot) return
    const lookup = await lookupReceipt(snapshot.idempotencyKey)
    const result = classifyReceiptLookup(lookup.status, lookup.payload)
    if (result === 'completed') {
      setSnapshot(null)
      setConsent(clearConsentAfterSuccess(consentRef.current))
      const latestView = await reload('silent')
      pushComplete((lookup.payload as { data: CheckoutReceiptData }).data, true, latestView)
      return
    }
    if (result === 'notFound') {
      rememberedRef.current = { key: snapshot.idempotencyKey, lineIds: snapshot.items.map((item) => item.cartItemId) }
      setSnapshot(null)
      await reload('panel')
      return
    }
    announce('구매 결과를 아직 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'alert', 'panel')
  }

  const onPrimary = () => {
    if (decision.state === 'retryable' && snapshot) {
      void submitCheckout(snapshot)
      return
    }
    pay()
  }

  const onSecondary = () => {
    if (decision.state === 'retryable') {
      void reselect()
      return
    }
    // 부족: [잔액 다시 확인]은 장바구니를 다시 읽는다.
    void reload('panel')
  }

  // ── 초점 대상(막대·ACK_REQUIRED) — 비활성 요소에는 주지 않는다 ─────────────────────────────────
  const focusTarget = (target: CheckoutFocusTarget) => {
    const panel = panelRef.current
    const candidates: Record<CheckoutFocusTarget, () => HTMLElement | null | undefined> = {
      status: () => alertsRef.current,
      title: () => titleRef.current,
      reload: () => panel?.querySelector<HTMLElement>('[data-checkout-focus="reload"]'),
      primary: () => primaryRef.current,
      conflict: () => document.querySelector<HTMLElement>('[data-conflict-line="true"] [role="checkbox"]'),
      partialAck: () => partialAckRef.current,
      consent: () => panel?.querySelector<HTMLElement>('[data-checkout-focus="consent"] [role="checkbox"]'),
    }
    let element = candidates[target]() ?? null
    if (!element || element.matches(':disabled, [aria-disabled="true"]')) element = titleRef.current
    if (!element) return
    const top = topRef.current
    if (modeRef.current === 'sticky' && top && top.contains(element)) {
      top.scrollTop = Math.max(0, element.offsetTop - top.offsetTop - 16)
      panel?.scrollIntoView({ block: 'nearest' })
      element.focus({ preventScroll: true })
      return
    }
    element.focus()
  }

  const goToPanel = () => {
    panelRef.current?.scrollIntoView({ block: 'nearest' })
    focusTarget(decision.focusTarget)
  }

  // ── 배치(6-2 원칙 3): 첫 그리기·글꼴 로드 끝·창 크기·고지 사본 교체 때만 판정 ─────────────────────
  const decideMode = useCallback(() => {
    const bottom = bottomRef.current
    const next: CheckoutPanelMode = !bottom || !window.matchMedia(LG_QUERY).matches
      ? 'flow'
      : decideCheckoutPanelMode({
        bottomHeight: bottom.getBoundingClientRect().height,
        maxInnerHeight: checkoutPanelMaxInnerHeight(window.innerHeight),
      })
    const wasSticky = modeRef.current === 'sticky'
    modeRef.current = next
    setMode(next)
    return { wasSticky, next }
  }, [])

  const hasItems = view.items.length > 0
  // 장바구니가 비면 막대가 없으므로 막대 여백·토스트 올림·scroll-padding 도 두지 않는다.
  const barVisible = barObserved && hasItems
  useEffect(() => {
    if (!hasItems) return
    decideMode()
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) decideMode()
    })
    const onResize = () => decideMode()
    window.addEventListener('resize', onResize)
    // 상태가 아닌 이유(글꼴·문구 줄바꿈)로 아래 묶음 높이가 바뀌면 다시 판정한다. 아래 묶음은 상태로 높이가 바뀌지 않는다(원칙 2).
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => decideMode())
    if (observer && bottomRef.current) observer.observe(bottomRef.current)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [hasItems, decideMode])

  // 고지 사본 교체: 다시 판정하고, 넘치게 되어 보통 흐름으로 바뀌면 결제 칸을 화면 안으로 스크롤한 뒤 알린다.
  const noticeIdentity = noticeCopyIdentity(consent.noticeCopy)
  const firstIdentityRef = useRef(noticeIdentity)
  useEffect(() => {
    if (firstIdentityRef.current === noticeIdentity) return
    firstIdentityRef.current = noticeIdentity
    const { wasSticky, next } = decideMode()
    if (wasSticky && next === 'flow') {
      panelRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [noticeIdentity, decideMode])

  // ── 고정 막대(6-2 원칙 4): 결제 버튼 줄이 화면 밖일 때 보인다 ─────────────────────────────────────
  useEffect(() => {
    const row = buttonRowRef.current
    if (!row || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      const rowVisible = entry.isIntersecting && entry.intersectionRatio >= 0.99
      if (rowVisible && barRef.current?.contains(document.activeElement)) {
        // 숨기기 전에 초점을 결제 칸 제목으로 옮긴다.
        titleRef.current?.focus({ preventScroll: true })
      }
      setBarVisible(!rowVisible)
    }, { threshold: [0, 0.99, 1] })
    observer.observe(row)
    return () => observer.disconnect()
  }, [hasItems])

  // 문서 scroll-padding: sticky 머리글과 막대에 초점 대상이 가리지 않게(대상별 여백은 겹치므로 쓰지 않음).
  useEffect(() => {
    const html = document.documentElement
    const previousTop = html.style.scrollPaddingTop
    const previousBottom = html.style.scrollPaddingBottom
    html.style.scrollPaddingTop = `${CHECKOUT_PANEL_STICKY_TOP}px`
    html.style.scrollPaddingBottom = barVisible ? `${CART_BAR_HEIGHT + 16}px` : ''
    return () => {
      html.style.scrollPaddingTop = previousTop
      html.style.scrollPaddingBottom = previousBottom
    }
  }, [barVisible])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const srReason = statusText || alertText ? '' : decision.blockedReason ?? ''
  const purchaseComplete = completeQueue[0] ?? null

  return (
    <>
      {/* 막대가 보이는 동안 토스트를 막대 위로 띄운다. */}
      {barVisible ? (
        <style>{`[data-sonner-toaster][data-y-position="bottom"]{--offset-bottom:${CART_BAR_HEIGHT + 16}px !important;--mobile-offset-bottom:${CART_BAR_HEIGHT + 16}px !important}`}</style>
      ) : null}
      <CartPageView
        count={view.count}
        isEmpty={!hasItems}
        upcomingNotice={upcomingNotice}
        barVisible={barVisible}
        list={(
          <CartLineListView
            items={items}
            selectableCount={selectableItems.length}
            selectedCount={lines.length}
            allSelected={allSelected}
            locked={listLocked}
            conflictLineIds={conflictIds}
            previousCredits={previousCredits}
            onToggle={(ids, isSelected) => void updateSelection(ids, isSelected)}
            onToggleAll={() => void updateSelection(selectableItems.map((item) => item.id), !allSelected)}
            onRemove={(ids) => void removeItems(ids)}
            onRemoveSelected={() => void removeItems(lines.map((item) => item.id))}
          />
        )}
        panel={(
          <CartCheckoutPanelView
            mode={mode}
            panelRef={panelRef}
            topRef={topRef}
            alertsRef={alertsRef}
            titleRef={titleRef}
            bottomRef={bottomRef}
            buttonRowRef={buttonRowRef}
            primaryRef={primaryRef}
            partialAckRef={partialAckRef}
            statusText={statusText}
            alertText={alertText}
            srReason={srReason}
            reloadFailed={reloadFailed}
            onReload={() => void reload('panel')}
            lines={lines.map((line) => ({
              id: line.id,
              title: getCartItemTitle(line),
              optionTitle: line.optionTitle,
              credits: line.chargedCredits ?? 0,
            }))}
            total={total}
            balance={view.balance}
            amountLine={buildAmountLine({ total, balance: view.balance, hasConflict: conflictIds.size > 0 })}
            cartTexts={consent.cartTexts}
            needsPartialAck={needsPartialAck}
            partialAck={consent.partialAck}
            onPartialAckChange={(checked) => { announce('', 'status', 'silent'); setConsent({ ...consentRef.current, partialAck: checked }) }}
            noticeCopy={noticeCopy}
            noticeAvailable={noticeAvailable}
            links={links}
            termsLink={view.termsLink}
            refundPolicyLink={view.refundPolicyLink}
            checkedKeys={consent.checkedKeys}
            onCheckedKeysChange={(keys) => { announce('', 'status', 'silent'); setConsent({ ...consentRef.current, checkedKeys: keys }) }}
            decision={decision}
            onPrimary={onPrimary}
            onSecondary={onSecondary}
            chargeHref={CHARGE_HREF}
          />
        )}
        bar={(
          <CartCheckoutBar
            visible={barVisible}
            selectedCount={lines.length}
            total={total}
            barRef={barRef}
            onGoToPanel={goToPanel}
          />
        )}
      />

      <MarketPurchaseCompleteDialog
        result={purchaseComplete}
        libraryHref={resolveMarketLibraryHref(purchaseComplete?.orders.map((order) => order.workspaceSubject) ?? [])}
        onClose={() => setCompleteQueue(dequeueComplete)}
      />
    </>
  )
}
