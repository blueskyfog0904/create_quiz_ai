import {
  checkoutConsentStructureKey,
  parseCheckoutConsentBundle,
  parseMarketCartTexts,
  type CheckoutConsentBundle,
  type MarketCartTexts,
} from '@/lib/checkout-consent'
import { parseMarketPurchaseNotice, type MarketPurchaseNotice } from '@/lib/market-purchase-policy'
import { findConflictingSelection } from '@/lib/market-selection-conflict'
import type { MarketCartItem, MarketCartView } from '@/lib/market-cart-server'

// 11번 6-1·6-3·6-4: 장바구니 결제 칸의 순수 함수(요청·화면 없음). 껍데기(cart-view.tsx)가 부르고 단위 시험이 고정한다.
// 화면은 cartTextsSha256 을 계산하지 않는다 — 받은 사본 값을 그대로 보낸다.

// ── 보인 고지 사본 ────────────────────────────────────────────────────────────────────────────────
export type CartNoticeCopy =
  | { format: 1; notice: MarketPurchaseNotice }
  | { format: 2; consent: CheckoutConsentBundle }

// 1판 동의는 체크 하나라 이 키 하나로 둔다(2판은 consentItems 의 key).
export const LEGACY_CONSENT_KEY = 'legacyNotice'

// 뷰의 두 칸(5-2) 중 값이 있는 칸으로 사본을 만든다. 둘 다 없으면 null(고지 없음).
export function noticeCopyFromView(view: Pick<MarketCartView, 'purchaseNotice' | 'purchaseConsent'>): CartNoticeCopy | null {
  if (view.purchaseConsent) return { format: 2, consent: view.purchaseConsent }
  if (view.purchaseNotice) return { format: 1, notice: view.purchaseNotice }
  return null
}

// 409 PURCHASE_NOTICE_CHANGED 의 details 를 새 해석기로 읽는다(2판 묶음 먼저). 둘 다 아니면 null.
export function noticeCopyFromDetails(details: unknown): CartNoticeCopy | null {
  const consent = parseCheckoutConsentBundle(details)
  if (consent) return { format: 2, consent }
  const notice = parseMarketPurchaseNotice(details)
  return notice ? { format: 1, notice } : null
}

export function noticeCopySha(copy: CartNoticeCopy): string {
  return copy.format === 2 ? copy.consent.noticeSha256 : copy.notice.noticeSha256
}

// 지문 + 구조(요약 줄 수·항목 수·항목마다 key·view·texts 수)가 같아야 같은 사본이다.
export function noticeCopyIdentity(copy: CartNoticeCopy | null): string {
  if (!copy) return 'none'
  return copy.format === 2
    ? `2:${copy.consent.noticeSha256}:${checkoutConsentStructureKey(copy.consent)}`
    : `1:${copy.notice.noticeSha256}`
}

export function consentItemKeys(copy: CartNoticeCopy | null): string[] {
  if (!copy) return []
  return copy.format === 2 ? copy.consent.consentItems.map((item) => item.key) : [LEGACY_CONSENT_KEY]
}

export function isConsentComplete(copy: CartNoticeCopy | null, checkedKeys: readonly string[]): boolean {
  const keys = consentItemKeys(copy)
  return keys.length > 0 && keys.every((key) => checkedKeys.includes(key))
}

// ── 선택 줄·주문 키 ───────────────────────────────────────────────────────────────────────────────
export function selectedLines(items: MarketCartItem[]): MarketCartItem[] {
  return items.filter((item) => item.purchasable && item.isSelected && item.chargedCredits !== null)
}

// 주문 키 = 선택 줄 cartItemId 정렬 묶음 + 줄별 expectedCredits. 바뀌면 동의를 비운다.
export function buildOrderKey(lines: { id: string; chargedCredits: number | null }[]): string {
  return [...lines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((line) => `${line.id}=${line.chargedCredits ?? 0}`).join('|')
}

// 선택된 부분 보유 줄 묶음(바뀌면 부분 보유 확인을 비운다)
export function buildPartialKey(lines: { id: string; partiallyOwned: boolean }[]): string {
  return lines.filter((line) => line.partiallyOwned).map((line) => line.id).sort().join('|')
}

export function conflictingLineIds(lines: MarketCartItem[]): Set<string> {
  return findConflictingSelection(lines.map((line) => ({
    id: line.id,
    itemId: line.itemId,
    targetKind: line.targetKind,
    categorySlug: line.categorySlug,
    includesPdf: line.includesPdf,
  }))).lineIds
}

// ── 동의 수명(6-4) ──────────────────────────────────────────────────────────────────────────────
export interface CartConsentState {
  noticeCopy: CartNoticeCopy | null
  cartTexts: MarketCartTexts | null
  checkedKeys: string[]
  partialAck: boolean
  orderKey: string
  partialKey: string
}

export interface CartConsentInput {
  noticeCopy: CartNoticeCopy | null
  cartTexts: MarketCartTexts | null
  orderKey: string
  partialKey: string
}

export interface CartConsentReconcile {
  state: CartConsentState
  // 사본(지문·구조) 이 바뀌어 동의를 비움 → '안내 문구가 바뀌었습니다'
  noticeChanged: boolean
  // 켜져 있던 동의를 주문 키 변화로 실제로 비움 → '주문 내용이 바뀌었습니다'
  orderChangedWhileChecked: boolean
}

export const NOTICE_CHANGED_MESSAGE = '안내 문구가 바뀌었습니다. 바뀐 내용을 확인한 뒤 다시 체크해 주세요.'
export const ORDER_CHANGED_MESSAGE = '주문 내용이 바뀌었습니다. 다시 확인한 뒤 체크해 주세요.'

export function initialConsentState(input: CartConsentInput): CartConsentState {
  return { ...input, checkedKeys: [], partialAck: false }
}

// 다시 읽기·409·선택 바꾸기 뒤 사본과 동의를 맞춘다. 체크가 켜진 채 지문·구조만 바뀌는 길은 없다.
export function reconcileConsent(previous: CartConsentState, next: CartConsentInput): CartConsentReconcile {
  let checkedKeys = previous.checkedKeys
  let partialAck = previous.partialAck
  let noticeChanged = false
  let orderChangedWhileChecked = false

  const copyChanged = noticeCopyIdentity(previous.noticeCopy) !== noticeCopyIdentity(next.noticeCopy)
  if (copyChanged) {
    checkedKeys = []
    noticeChanged = previous.noticeCopy !== null
  }
  const cartTextsChanged = (previous.cartTexts?.cartTextsSha256 ?? null) !== (next.cartTexts?.cartTextsSha256 ?? null)
  if (cartTextsChanged) {
    checkedKeys = []
    partialAck = false
    noticeChanged = noticeChanged || previous.cartTexts !== null
  }
  if (previous.orderKey !== next.orderKey) {
    if (checkedKeys.length > 0) orderChangedWhileChecked = true
    checkedKeys = []
  }
  if (previous.partialKey !== next.partialKey) partialAck = false

  return {
    state: { ...next, checkedKeys, partialAck },
    noticeChanged,
    orderChangedWhileChecked,
  }
}

// 성공하면 동의·부분 보유 확인을 모두 비운다.
// 다시 읽은 뷰로 동의를 맞춘 뒤 무엇을 알릴지(6-2 알림 자리). 결제 응답의 이유(responseAlert)를 띄운 직후의 다시 읽기에서는
// 그 이유를 지우지 않는다: 주문 바뀜(응답 때문에 생긴 결과)은 알리지 않고, 고지가 바뀌었으면 이유 뒤에 붙인다.
export function reconcileAnnouncement(
  result: Pick<CartConsentReconcile, 'noticeChanged' | 'orderChangedWhileChecked'>,
  responseAlert: string | null,
): { text: string; kind: 'status' | 'alert' } | null {
  if (responseAlert !== null) return result.noticeChanged ? { text: `${responseAlert} ${NOTICE_CHANGED_MESSAGE}`, kind: 'alert' } : null
  if (result.noticeChanged) return { text: NOTICE_CHANGED_MESSAGE, kind: 'status' }
  if (result.orderChangedWhileChecked) return { text: ORDER_CHANGED_MESSAGE, kind: 'status' }
  return null
}

// 409 로 바꾼 고지 사본을 뷰에도 맞춘다(뷰 칸 나눔 5-2 그대로: 판 1 이면 purchaseNotice 만, 판 2 면 purchaseConsent 만).
// 뷰가 옛 고지로 남으면 다음 줄 선택 때 동의 사본이 옛 고지로 되돌아간다.
export function viewWithNoticeCopy<T extends Pick<MarketCartView, 'purchaseNotice' | 'purchaseConsent' | 'cartTexts'>>(
  view: T, copy: CartNoticeCopy, cartTexts: MarketCartView['cartTexts'],
): T {
  return {
    ...view,
    purchaseNotice: copy.format === 1 ? copy.notice : null,
    purchaseConsent: copy.format === 2 ? copy.consent : null,
    cartTexts,
  }
}

export function clearConsentAfterSuccess(state: CartConsentState): CartConsentState {
  return { ...state, checkedKeys: [], partialAck: false }
}

// ── 결제 버튼(6-3): 이름·열림을 한 함수에서 고르고 막대도 같은 값을 쓴다 ──────────────────────────────
export type CheckoutButtonState =
  | 'submitting'
  | 'reloading'
  | 'saving'
  | 'reloadFailed'
  | 'retryable'
  | 'empty'
  | 'noNotice'
  | 'conflict'
  | 'insufficient'
  | 'partialAck'
  | 'consent'
  | 'ready'

// 막대를 눌렀을 때 초점 대상. 비활성 요소에는 주지 않는다(조작이 없으면 알림 자리·결제 칸 제목).
export type CheckoutFocusTarget =
  | 'status'
  | 'title'
  | 'reload'
  | 'primary'
  | 'conflict'
  | 'partialAck'
  | 'consent'

export interface CheckoutButtonInput {
  submitting: boolean
  reloading: boolean
  saving: boolean
  reloadFailed: boolean
  retryable: boolean
  selectedCount: number
  noticeAvailable: boolean
  hasConflict: boolean
  total: number
  balance: number
  needsPartialAck: boolean
  partialAck: boolean
  consentComplete: boolean
}

export interface CheckoutButtonDecision {
  state: CheckoutButtonState
  primaryLabel: string
  primaryEnabled: boolean
  // retryable·부족일 때만 같은 높이 버튼 줄의 둘째 버튼
  secondaryLabel: string | null
  // 막힌 이유(sr-only live 영역에 둔다). 결제할 수 있으면 null.
  blockedReason: string | null
  focusTarget: CheckoutFocusTarget
  // 0건이면 동의 체크도 비활성
  consentDisabled: boolean
  // 결제·재시도 중에는 목록 조작·부분 보유 확인·동의 체크를 잠근다(창 열기·보기는 열어 둠)
  locked: boolean
}

export function formatCartCredits(value: number): string {
  return value.toLocaleString('ko-KR')
}

export function decideCheckoutButton(input: CheckoutButtonInput): CheckoutButtonDecision {
  const base = { secondaryLabel: null, consentDisabled: false, locked: false }
  if (input.submitting) {
    return { ...base, state: 'submitting', primaryLabel: '결제하는 중…', primaryEnabled: false, blockedReason: '결제하는 중입니다.', focusTarget: 'status', locked: true }
  }
  if (input.reloading) {
    return { ...base, state: 'reloading', primaryLabel: '장바구니를 다시 읽는 중…', primaryEnabled: false, blockedReason: '장바구니를 다시 읽는 중입니다.', focusTarget: 'status', locked: input.retryable }
  }
  if (input.saving) {
    return { ...base, state: 'saving', primaryLabel: '선택을 저장하는 중…', primaryEnabled: false, blockedReason: '선택을 저장하는 중입니다.', focusTarget: 'status', locked: input.retryable }
  }
  if (input.reloadFailed) {
    return { ...base, state: 'reloadFailed', primaryLabel: '장바구니를 다시 불러와 주세요', primaryEnabled: false, blockedReason: '장바구니를 다시 불러오지 못했습니다.', focusTarget: 'reload', locked: input.retryable }
  }
  if (input.retryable) {
    return { ...base, state: 'retryable', primaryLabel: '같은 요청으로 다시 시도', primaryEnabled: true, secondaryLabel: '다시 선택', blockedReason: '결제 결과를 확인하지 못했습니다.', focusTarget: 'primary', locked: true }
  }
  if (input.selectedCount === 0) {
    return { ...base, state: 'empty', primaryLabel: '자료를 선택하세요', primaryEnabled: false, blockedReason: '결제할 자료를 선택하세요.', focusTarget: 'title', consentDisabled: true }
  }
  if (!input.noticeAvailable) {
    return { ...base, state: 'noNotice', primaryLabel: '지금은 결제할 수 없습니다', primaryEnabled: false, blockedReason: '결제 전 확인 내용을 불러오지 못했습니다.', focusTarget: 'reload' }
  }
  // 충돌을 부족보다 앞에 둔다(부풀어 오른 합계로 충전을 권하지 않음).
  if (input.hasConflict) {
    return { ...base, state: 'conflict', primaryLabel: '함께 살 수 없는 자료가 선택됐어요', primaryEnabled: false, blockedReason: '함께 살 수 없는 자료가 선택되었습니다. 표시된 줄 중 하나를 빼 주세요.', focusTarget: 'conflict' }
  }
  if (input.total > input.balance) {
    return { ...base, state: 'insufficient', primaryLabel: '크레딧 충전', primaryEnabled: true, secondaryLabel: '잔액 다시 확인', blockedReason: '보유 크레딧이 부족합니다.', focusTarget: 'primary' }
  }
  if (input.needsPartialAck && !input.partialAck) {
    return { ...base, state: 'partialAck', primaryLabel: '정가 구매 확인을 체크해 주세요', primaryEnabled: false, blockedReason: '정가 구매 확인을 체크해 주세요.', focusTarget: 'partialAck' }
  }
  if (!input.consentComplete) {
    return { ...base, state: 'consent', primaryLabel: '필수 동의를 체크해 주세요', primaryEnabled: false, blockedReason: '필수 동의를 체크해 주세요.', focusTarget: 'consent' }
  }
  return { ...base, state: 'ready', primaryLabel: `${formatCartCredits(input.total)} 크레딧 결제하기`, primaryEnabled: true, blockedReason: null, focusTarget: 'primary' }
}

// 금액 한 줄(단위 없음). 충돌이면 '부족'을 보이지 않는다.
export function buildAmountLine(input: { total: number; balance: number; hasConflict: boolean }): string {
  const total = `합계 ${formatCartCredits(input.total)}`
  if (input.hasConflict) return total
  const remain = input.balance - input.total
  return remain >= 0
    ? `${total} · 결제 후 잔액 ${formatCartCredits(remain)}`
    : `${total} · 부족 ${formatCartCredits(-remain)}`
}

// ── 요청 스냅숏·키 수명(6-4) ────────────────────────────────────────────────────────────────────────
export interface CheckoutRequestBody {
  items: { cartItemId: string; expectedCredits: number; acknowledgeNoDiscount: boolean }[]
  idempotencyKey: string
  acknowledgePurchaseNotice: true
  noticeSha256: string
  cartTextsSha256: string
}

// 스냅숏 = 줄마다 cartItemId·expectedCredits·acknowledgeNoDiscount + 고지·장바구니 문구 지문(사본 값 그대로) + 요청 키.
export function buildCheckoutRequest(input: {
  lines: MarketCartItem[]
  partialAck: boolean
  noticeCopy: CartNoticeCopy
  cartTexts: MarketCartTexts
  idempotencyKey: string
}): CheckoutRequestBody {
  return {
    items: input.lines.map((line) => ({
      cartItemId: line.id,
      expectedCredits: line.chargedCredits ?? 0,
      acknowledgeNoDiscount: line.partiallyOwned && input.partialAck,
    })),
    idempotencyKey: input.idempotencyKey,
    acknowledgePurchaseNotice: true,
    noticeSha256: noticeCopySha(input.noticeCopy),
    cartTextsSha256: input.cartTexts.cartTextsSha256,
  }
}

// ── 응답 처리(6-4 응답별) ───────────────────────────────────────────────────────────────────────────
export interface CheckoutResponseInput {
  // 네트워크 오류·응답 없음이면 null
  status: number | null
  payload: unknown
}

export interface CheckoutReceiptData {
  orders: { orderId: string; itemTitle: string; optionTitle: string | null; categoryName: string | null; chargedCredits: number; workspaceSubject: string }[]
  totalCredits: number
  balanceAfter?: number
}

export type CheckoutOutcome =
  // 키·스냅숏 유지, 나가는 길은 [같은 요청으로 다시 시도]·[다시 선택]
  | { kind: 'retryable'; message: string }
  | { kind: 'success'; data: CheckoutReceiptData; alreadyCompleted: boolean; balance: number | null }
  | { kind: 'login' }
  // 바뀐 사본으로 교체·동의 비움. 해석 실패면 noticeCopy null → 잠그고 다시 읽기
  | { kind: 'noticeChanged'; noticeCopy: CartNoticeCopy | null; cartTexts: MarketCartTexts | null; parseFailed: boolean; message: string }
  // 다시 읽고 '이전 N → 지금 M'(이전 가격은 따로 둠)
  | { kind: 'priceChanged'; previousCredits: Record<string, number>; message: string }
  | { kind: 'insufficient'; message: string }
  // 다시 읽고 details.lines 줄을 부분 보유로 보이게 한 뒤 확인을 비우고 초점
  | { kind: 'ackRequired'; lineIds: string[]; message: string }
  | { kind: 'conflicting'; itemIds: string[]; message: string }
  // CART_CHANGED·ALREADY_OWNED·BUNDLE_COMPONENTS_EMPTY·IDEMPOTENCY_CONFLICT·그 밖 400·404·422: 안내 + 다시 읽기
  | { kind: 'reload'; code: string | null; message: string; recheckReceipt: boolean }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const RETRY_SUFFIX = ' 다시 시도하면 같은 요청으로 처리되어 중복으로 차감되지 않습니다.'

// 성공 외 응답은 모두 스냅숏을 버린다(다음 클릭에 새 키). 네트워크 오류·응답 없음·5xx 만 retryable.
// 403 동의 필요는 껍데기가 redirectToConsentIfRequired 로 먼저 처리한다.
export function reduceCheckoutResponse(
  state: { snapshot: CheckoutRequestBody | null },
  response: CheckoutResponseInput
): CheckoutOutcome {
  const payload = asRecord(response.payload) ?? {}
  const error = asRecord(payload.error)
  const code = typeof error?.code === 'string' ? error.code : null
  const message = typeof error?.message === 'string' && error.message ? error.message : '구매 처리에 실패했습니다.'
  const details = asRecord(payload.details)

  if (response.status === null) {
    return { kind: 'retryable', message: `네트워크 오류로 구매 결과를 확인하지 못했습니다.${RETRY_SUFFIX}` }
  }
  if (response.status >= 200 && response.status < 300 && payload.success === true) {
    return {
      kind: 'success',
      data: (asRecord(payload.data) ?? { orders: [], totalCredits: 0 }) as unknown as CheckoutReceiptData,
      alreadyCompleted: payload.alreadyCompleted === true,
      balance: typeof payload.balance === 'number' ? payload.balance : null,
    }
  }
  if (response.status >= 500) {
    return { kind: 'retryable', message: `${message}${RETRY_SUFFIX}` }
  }
  if (response.status === 401) return { kind: 'login' }
  if (response.status === 402) return { kind: 'insufficient', message: '보유 크레딧이 부족해 구매하지 못했습니다. 크레딧을 충전한 뒤 다시 구매해 주세요.' }

  if (code === 'PURCHASE_NOTICE_CHANGED') {
    const noticeCopy = noticeCopyFromDetails(payload.details)
    const cartTexts = parseMarketCartTexts(payload.cartTexts)
    return { kind: 'noticeChanged', noticeCopy, cartTexts, parseFailed: noticeCopy === null || cartTexts === null, message }
  }
  if (code === 'PRICE_CHANGED') {
    const previousCredits: Record<string, number> = {}
    const latest = Array.isArray(details?.items) ? details.items as unknown[] : []
    for (const raw of latest) {
      const item = asRecord(raw)
      if (!item || typeof item.cartItemId !== 'string') continue
      const sent = state.snapshot?.items.find((line) => line.cartItemId === item.cartItemId)
      if (sent && typeof item.chargedCredits === 'number' && item.chargedCredits !== sent.expectedCredits) {
        previousCredits[item.cartItemId] = sent.expectedCredits
      }
    }
    return { kind: 'priceChanged', previousCredits, message }
  }
  if (code === 'ACK_REQUIRED') {
    const lines = Array.isArray(details?.lines) ? details.lines as unknown[] : []
    const lineIds = lines.flatMap((raw) => {
      const line = asRecord(raw)
      return line && typeof line.cartItemId === 'string' ? [line.cartItemId] : []
    })
    return { kind: 'ackRequired', lineIds, message }
  }
  if (code === 'CONFLICTING_SELECTION') {
    const itemIds = Array.isArray(details?.itemIds) ? (details.itemIds as unknown[]).filter((id): id is string => typeof id === 'string') : []
    return { kind: 'conflicting', itemIds, message }
  }
  return { kind: 'reload', code, message, recheckReceipt: code === 'CART_CHANGED' || code === 'ALREADY_OWNED' }
}

// ── [다시 선택](6-4): 먼저 영수증 조회 ─────────────────────────────────────────────────────────────
export type ReselectOutcome = 'completed' | 'notFound' | 'keepRetryable'

export function classifyReceiptLookup(status: number | null, payload: unknown): ReselectOutcome {
  if (status === 200 && asRecord(payload)?.success === true) return 'completed'
  if (status === 404) return 'notFound'
  return 'keepRetryable'
}

// 404 뒤 기억한 직전 키의 줄이 다시 읽기에서 사라졌으면 한 번 더 조회한다(완료 창 없이 잔액만 준 화면이 남지 않게).
export function shouldRecheckAfterReload(remembered: { lineIds: string[] } | null, items: { id: string }[]): boolean {
  if (!remembered) return false
  const present = new Set(items.map((item) => item.id))
  return remembered.lineIds.some((id) => !present.has(id))
}

// 완료 창 차례: 겹치면 차례로 보인다.
export function enqueueComplete<T>(queue: T[], result: T): T[] {
  return [...queue, result]
}

export function dequeueComplete<T>(queue: T[]): T[] {
  return queue.slice(1)
}
