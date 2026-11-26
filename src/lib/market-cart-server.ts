import 'server-only'

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import {
  toMarketCheckoutFailure,
  type MarketCheckoutOutcome,
  type MarketCheckoutReceipt,
} from '@/lib/market-checkout-server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import type { MarketPurchaseNotice } from '@/lib/market-purchase-policy'
import { buildMarketPurchaseInfo, type MarketPurchaseLink } from '@/lib/market-purchase-info'
import { readMarketPurchaseConsentUncached, type MarketPurchaseConsentRead } from '@/lib/market-purchase-policy-server'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import type { CheckoutConsentBundle, MarketCartInsufficientTexts, MarketCartTexts } from '@/lib/checkout-consent'

export type MarketCartTargetKind = 'subproduct' | 'bundle'

export interface MarketCartItem {
  id: string
  targetKind: MarketCartTargetKind
  targetId: string
  itemId: string | null
  workspaceSubject: WorkspaceSubject | null
  itemTitle: string | null
  optionTitle: string | null
  categoryName: string | null
  purchasable: boolean
  reason: 'NOT_FOUND' | 'UNAVAILABLE' | 'ALREADY_OWNED' | null
  partiallyOwned: boolean
  originalCredits: number | null
  chargedCredits: number | null
  isSelected: boolean
  createdAt: string
  // 상세가 열리는 상품만 링크를 준다(게시·활성 상품 + 공개 메뉴, 같은 과목). 그 외는 null.
  detailHref: string | null
  // 11번 6-3: 함께 살 수 없는 선택 미리 막기(evaluate_market_targets 값 그대로 — DB 결제 6단계와 같은 판정에 쓴다)
  categorySlug: string | null
  includesPdf: boolean
}

export interface MarketCartView {
  items: MarketCartItem[]
  count: number
  balance: number
  // 11번 5-2: 해석기를 거치지 않는 옛 탭을 위해 판마다 칸을 나눈다. 둘 중 하나만 값이 있다(읽지 못하면 둘 다 null — 결제 막힘).
  // 1판 고지(펼친 고지, DB 문구·서버 지문). 2판일 때는 null 이라 옛 장바구니 탭은 막힌다.
  purchaseNotice: MarketPurchaseNotice | null
  // 2판 묶음(접는 동의). 1판일 때는 null.
  purchaseConsent: CheckoutConsentBundle | null
  // 장바구니 결제 칸 문구(판과 관계없음). 규칙을 어기거나 읽지 못하면 null — 결제 막힘.
  cartTexts: MarketCartTexts | null
  // 잔액 부족 충전 안내 틀({부족크레딧} 채우기 전)과 두 버튼 이름(지문과 무관). 없거나 깨지면 null — 부족이면 결제만 막는다.
  cartInsufficientTexts: MarketCartInsufficientTexts | null
  // 개발 스위치(10-1)가 켜졌을 때만 값이 있다.
  consentPreview: { keysMissing: boolean } | null
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
}

type MarketCartFailure = Extract<MarketCheckoutOutcome, { ok: false }>
type MarketCartOutcome<T> = { ok: true; data: T } | MarketCartFailure

interface CartRow {
  id: string
  target_kind: MarketCartTargetKind
  subproduct_id: string | null
  bundle_option_id: string | null
  is_selected: boolean
  created_at: string
}

interface EvaluatedTarget {
  itemId: string | null
  workspaceSubject: WorkspaceSubject | null
  itemTitle: string | null
  optionTitle: string | null
  categoryName: string | null
  categorySlug: string | null
  includesPdf: boolean | null
  purchasable: boolean
  reason: MarketCartItem['reason']
  partiallyOwned: boolean
  originalCredits: number | null
  chargedCredits: number | null
}

type CartRpcResult = ({ ok: true } | { ok: false; code: string }) & Record<string, unknown>

const MAX_CART_ROWS = 50

// 신규 cart 테이블·RPC는 src/types/supabase.ts에 아직 없어 스키마 비지정 client로 호출한다.
function cartDb() {
  return createAdminClient() as unknown as SupabaseClient
}

export function marketCartErrorResponse(failure: Pick<MarketCartFailure, 'status' | 'code' | 'message' | 'details'> & {
  cartTexts?: MarketCartTexts | null
}) {
  return NextResponse.json({
    success: false,
    error: { code: failure.code, message: failure.message },
    details: failure.details,
    // 11번 5-2: 구매 고지 409 에만 최상위 장바구니 문구 자리를 둔다.
    ...(failure.cartTexts !== undefined ? { cartTexts: failure.cartTexts } : {}),
  }, { status: failure.status })
}

// 11번 4-4: 장바구니 화면용 동의 읽기(캐시 없음). 1판 정책을 읽지 못하면 고지 없음(결제 막힘).
async function readCartConsent(): Promise<MarketPurchaseConsentRead | null> {
  try {
    return await readMarketPurchaseConsentUncached()
  } catch (error) {
    console.error('구매 고지 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 5절 공통: 비로그인 → 401. userId는 세션에서만 얻는다.
export async function guardMarketCartRequest() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      response: marketCartErrorResponse({ status: 401, code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' }),
    }
  }

  return { userId: user.id }
}

async function callCartRpc(fn: string, params: Record<string, unknown>): Promise<MarketCartOutcome<Record<string, unknown>>> {
  const { data, error } = await cartDb().rpc(fn, params)

  if (error) {
    console.error(`[MarketCart] ${fn} failed`, { code: error.code })
    return toMarketCheckoutFailure('INTERNAL_SERVER_ERROR') as MarketCartFailure
  }

  const result = data as CartRpcResult
  if (!result.ok) {
    return toMarketCheckoutFailure(result.code, result) as MarketCartFailure
  }

  return { ok: true, data: result }
}

export async function getMarketCartCount(userId: string) {
  const { count, error } = await cartDb()
    .from('market_cart_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (error) {
    console.error('[MarketCart] count failed', { code: error.code })
    return 0
  }

  return count ?? 0
}

// 헤더 배지용: 비로그인이면 null(배지 숨김).
export async function getMarketCartBadgeCount(userId: string | null) {
  if (!userId) {
    return null
  }

  return getMarketCartCount(userId)
}

// 표시 가격·구매 가능 여부는 checkout과 같은 evaluate_market_targets SQL에서 받는다(4절).
// 상세 page(/items/[itemId])와 같은 공개 조건(공개·활성·미삭제)을 만족할 때만 경로를 만든다. 실패하면 링크 없이 장바구니를 보여 준다.
export async function getMarketCartDetailHrefs(db: SupabaseClient, itemIds: string[]): Promise<Map<string, string>> {
  const hrefs = new Map<string, string>()
  if (itemIds.length === 0) {
    return hrefs
  }

  const { data: items, error: itemsError } = await db
    .from('market_items')
    .select('id, workspace_subject')
    .in('id', itemIds)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (itemsError) {
    console.error('[MarketCart] detail link items lookup failed', { code: itemsError.code })
    return hrefs
  }

  for (const item of (items ?? []) as { id: string; workspace_subject: string }[]) {
    hrefs.set(item.id, `/items/${item.id}?subject=${item.workspace_subject}`)
  }
  return hrefs
}

export async function getMarketCartView(userId: string): Promise<MarketCartView> {
  const db = cartDb()
  const { data, error } = await db
    .from('market_cart_items')
    .select('id, target_kind, subproduct_id, bundle_option_id, is_selected, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(MAX_CART_ROWS)

  if (error) {
    throw new Error('장바구니를 불러오지 못했습니다.')
  }

  const rows = (data ?? []) as CartRow[]
  let evaluated: EvaluatedTarget[] = []

  if (rows.length > 0) {
    const { data: evaluation, error: evaluationError } = await db.rpc('evaluate_market_targets', {
      p_user_id: userId,
      p_targets: rows.map((row) => ({
        targetKind: row.target_kind,
        targetId: row.subproduct_id ?? row.bundle_option_id,
      })),
    })

    if (evaluationError) {
      throw new Error('장바구니 가격을 계산하지 못했습니다.')
    }

    evaluated = evaluation as EvaluatedTarget[]
  }

  const detailHrefs = await getMarketCartDetailHrefs(
    db,
    [...new Set(evaluated.flatMap((target) => (target.itemId ? [target.itemId] : [])))]
  )
  const [snapshot, consentRead, footerContent] = await Promise.all([
    getCreditBalanceSnapshot(userId),
    readCartConsent(),
    getSiteFooterContent(),
  ])
  const purchaseInfo = buildMarketPurchaseInfo(footerContent)

  return {
    items: rows.map((row, index) => {
      const target = evaluated[index]
      return {
        id: row.id,
        targetKind: row.target_kind,
        targetId: (row.subproduct_id ?? row.bundle_option_id) as string,
        itemId: target.itemId,
        workspaceSubject: target.workspaceSubject,
        itemTitle: target.itemTitle,
        optionTitle: target.optionTitle,
        categoryName: target.categoryName,
        purchasable: target.purchasable,
        reason: target.reason,
        partiallyOwned: target.partiallyOwned,
        originalCredits: target.originalCredits,
        chargedCredits: target.chargedCredits,
        isSelected: row.is_selected,
        createdAt: row.created_at,
        detailHref: target.itemId ? detailHrefs.get(target.itemId) ?? null : null,
        categorySlug: target.categorySlug ?? null,
        includesPdf: target.includesPdf === true,
      }
    }),
    count: rows.length,
    balance: selectDisplayBalance(userId, snapshot),
    purchaseNotice: consentRead?.consentFormat === 1 ? consentRead.notice : null,
    purchaseConsent: consentRead?.consentFormat === 2 ? consentRead.consent : null,
    cartTexts: consentRead?.cartTexts ?? null,
    cartInsufficientTexts: consentRead?.insufficientTexts ?? null,
    consentPreview: consentRead?.preview ?? null,
    termsLink: purchaseInfo.termsLink,
    refundPolicyLink: purchaseInfo.refundPolicyLink,
  }
}

export async function addMarketCartItem(userId: string, targetKind: MarketCartTargetKind, targetId: string) {
  return callCartRpc('add_market_cart_item', {
    p_user_id: userId,
    p_target_kind: targetKind,
    p_target_id: targetId,
  })
}

export async function setMarketCartSelection(userId: string, ids: string[], isSelected: boolean) {
  return callCartRpc('set_market_cart_selection', {
    p_user_id: userId,
    p_ids: ids,
    p_selected: isSelected,
  })
}

export async function removeMarketCartItems(userId: string, ids: string[]) {
  return callCartRpc('remove_market_cart_items', {
    p_user_id: userId,
    p_ids: ids,
  })
}

// 3.2: 영수증은 result_payload 스냅샷으로 보여주고, 상품 hard delete로 사라진 child 주문은 deleted로 표시한다.
export async function getMarketCheckoutReceipt(userId: string, idempotencyKey: string) {
  const db = cartDb()
  const { data: batch, error } = await db
    .from('market_checkout_batches')
    .select('result_payload')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (error) {
    throw new Error('구매 영수증을 불러오지 못했습니다.')
  }

  if (!batch) {
    return null
  }

  const receipt = batch.result_payload as Omit<MarketCheckoutReceipt, 'alreadyCompleted'>
  const orderIds = receipt.orders.map((order) => order.orderId)
  const { data: orders, error: ordersError } = await db
    .from('market_purchase_orders')
    .select('id')
    .eq('user_id', userId)
    .in('id', orderIds)

  if (ordersError) {
    throw new Error('구매 영수증을 불러오지 못했습니다.')
  }

  const existingIds = new Set(((orders ?? []) as { id: string }[]).map((order) => order.id))

  return {
    ...receipt,
    alreadyCompleted: true,
    orders: receipt.orders.map((order) => ({ ...order, deleted: !existingIds.has(order.orderId) })),
  }
}
