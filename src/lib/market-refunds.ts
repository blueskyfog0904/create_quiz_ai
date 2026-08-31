import { CreditService } from '@/lib/credits'
import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { Json, Tables, TablesInsert } from '@/types/supabase'

type MarketRefundRequest = Tables<'market_refund_requests'>
type MarketRefundTargetKind = 'legacy_purchase' | 'v2_order'
export type MarketRefundRequestStatus = 'pending' | 'approved' | 'rejected' | 'canceled' | 'failed'

interface CreditConsumptionSnapshot {
  sourceId: string
  amount: number
}

export interface MarketRefundEligibility {
  targetKind: MarketRefundTargetKind
  targetId: string
  userId: string
  itemId: string
  workspaceSubject: WorkspaceSubject
  purchasedAt: string
  refundDeadline: string
  requestedRefundCredits: number
  downloadCount: number
  status: 'available' | 'blocked' | MarketRefundRequestStatus
  refundable: boolean
  reason: string | null
  creditConsumptions: CreditConsumptionSnapshot[]
}

export interface MarketRefundRequestInput {
  userId: string
  targetKind: MarketRefundTargetKind
  targetId: string
  reason?: string | null
}

export interface MarketRefundProcessInput {
  requestId: string
  adminId: string
  adminNote?: string | null
}

// loadRefundTarget과 동일한 형태. 호출자가 이미 로드한 구매/주문 행으로 왕복을 생략할 때 사용한다.
export interface MarketRefundTargetSnapshot {
  targetKind: MarketRefundTargetKind
  targetId: string
  userId: string
  itemId: string
  workspaceSubject: WorkspaceSubject
  purchasedAt: string
  status: string
  refundCredits: number
  creditConsumptions: CreditConsumptionSnapshot[]
}

interface MarketRefundEligibilityOptions {
  ignoreRequestStatus?: boolean
  // 배치 조회한 값으로 개별 왕복(loadRefundTarget/countDownloads/getLatestRequestStatus)을 생략한다.
  // latestRequestStatus는 null이 "요청 없음 확인됨"을 의미한다 (키 부재 시 개별 조회).
  preloaded?: {
    target?: MarketRefundTargetSnapshot
    downloadCount?: number
    latestRequestStatus?: MarketRefundRequestStatus | null
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function normalizeWorkspaceSubject(value?: string | null): WorkspaceSubject {
  return value === 'korean' ? 'korean' : DEFAULT_WORKSPACE_SUBJECT
}

function parseCreditConsumptions(value: unknown): CreditConsumptionSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const sourceId = (entry as { sourceId?: unknown; source_id?: unknown }).sourceId
        ?? (entry as { source_id?: unknown }).source_id
      const amount = (entry as { amount?: unknown }).amount

      if (typeof sourceId !== 'string' || typeof amount !== 'number' || amount <= 0) {
        return null
      }

      return { sourceId, amount }
    })
    .filter((entry): entry is CreditConsumptionSnapshot => entry !== null)
}

async function countDownloads(targetKind: MarketRefundTargetKind, targetId: string) {
  const supabase = createAdminClient()
  const query = targetKind === 'v2_order'
    ? supabase.from('market_download_events').select('id', { count: 'exact', head: true }).eq('order_id', targetId)
    : supabase.from('market_download_events').select('id', { count: 'exact', head: true }).eq('purchase_id', targetId)

  const { count, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

async function getLatestRequestStatus(targetKind: MarketRefundTargetKind, targetId: string) {
  const supabase = createAdminClient()
  const query = targetKind === 'v2_order'
    ? supabase.from('market_refund_requests').select('status').eq('target_kind', targetKind).eq('order_id', targetId)
    : supabase.from('market_refund_requests').select('status').eq('target_kind', targetKind).eq('legacy_purchase_id', targetId)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.status as MarketRefundRequestStatus | undefined
}

async function loadRefundTarget(input: MarketRefundRequestInput) {
  const supabase = createAdminClient()

  if (input.targetKind === 'legacy_purchase') {
    const { data, error } = await supabase
      .from('market_purchases')
      .select('*')
      .eq('id', input.targetId)
      .eq('user_id', input.userId)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      throw new Error('환불 요청할 구매 내역을 찾을 수 없습니다.')
    }

    return {
      targetKind: input.targetKind,
      targetId: data.id,
      userId: data.user_id,
      itemId: data.item_id,
      workspaceSubject: normalizeWorkspaceSubject((data as { workspace_subject?: string | null }).workspace_subject),
      purchasedAt: data.purchased_at,
      status: data.status,
      refundCredits: data.price_credits,
      creditConsumptions: parseCreditConsumptions(data.credit_consumptions),
    }
  }

  const { data, error } = await supabase
    .from('market_purchase_orders')
    .select('*')
    .eq('id', input.targetId)
    .eq('user_id', input.userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error('환불 요청할 구매 내역을 찾을 수 없습니다.')
  }

  return {
    targetKind: input.targetKind,
    targetId: data.id,
    userId: data.user_id,
    itemId: data.item_id,
    workspaceSubject: normalizeWorkspaceSubject(data.workspace_subject),
    purchasedAt: data.created_at,
    status: data.status,
    refundCredits: data.charged_credits,
    creditConsumptions: parseCreditConsumptions(data.credit_consumptions),
  }
}

// PDF 구매를 기준으로 HWP 차액 업그레이드가 이뤄진 경우, 기준이 된 PDF 주문의 환불을 막는다.
// (환불 허용 시 사용자가 차액만 내고 HWP+PDF 전체를 보유하는 루프홀이 생김.
//  차액 주문 여부는 original_price_credits > charged_credits 마커로 판별.)
async function isUpgradeBaseOrder(
  targetKind: MarketRefundTargetKind,
  orderId: string,
  userId: string,
  itemId: string
): Promise<boolean> {
  if (targetKind !== 'v2_order') {
    return false
  }

  const supabase = createAdminClient()
  const { data: orderEntitlements, error: orderEntitlementError } = await supabase
    .from('market_entitlements')
    .select('scope, subproduct_id')
    .eq('source_order_id', orderId)
    .eq('status', 'active')

  if (orderEntitlementError) {
    throw new Error(orderEntitlementError.message)
  }

  const refundSubproductIds = (orderEntitlements ?? [])
    .filter((entitlement) => entitlement.scope === 'subproduct' && entitlement.subproduct_id)
    .map((entitlement) => entitlement.subproduct_id!)

  if (refundSubproductIds.length === 0) {
    return false
  }

  const { data: userEntitlements, error: userEntitlementError } = await supabase
    .from('market_entitlements')
    .select('subproduct_id, source_order_id')
    .eq('user_id', userId)
    .eq('item_id', itemId)
    .eq('scope', 'subproduct')
    .eq('status', 'active')

  if (userEntitlementError) {
    throw new Error(userEntitlementError.message)
  }

  const userSubproductIds = (userEntitlements ?? [])
    .filter((entitlement) => entitlement.subproduct_id)
    .map((entitlement) => entitlement.subproduct_id!)
  const allSubproductIds = Array.from(new Set([...refundSubproductIds, ...userSubproductIds]))
  const { data: subproducts, error: subproductError } = await supabase
    .from('market_item_subproducts')
    .select('id, category_id')
    .in('id', allSubproductIds)

  if (subproductError) {
    throw new Error(subproductError.message)
  }

  const categoryIds = Array.from(new Set((subproducts ?? []).map((subproduct) => subproduct.category_id)))
  const { data: categories, error: categoryError } = categoryIds.length > 0
    ? await supabase
      .from('market_subproduct_categories')
      .select('id, slug')
      .in('id', categoryIds)
    : { data: [], error: null }

  if (categoryError) {
    throw new Error(categoryError.message)
  }

  const slugByCategoryId = new Map((categories ?? []).map((category) => [category.id, category.slug]))
  const slugBySubproductId = new Map(
    (subproducts ?? []).map((subproduct) => [subproduct.id, slugByCategoryId.get(subproduct.category_id) ?? null])
  )

  const refundTargetsPdf = refundSubproductIds.some((id) => slugBySubproductId.get(id) === 'question_pdf')
  if (!refundTargetsPdf) {
    return false
  }

  const hwpSourceOrderIds = (userEntitlements ?? [])
    .filter((entitlement) => (
      entitlement.subproduct_id
      && slugBySubproductId.get(entitlement.subproduct_id) === 'question_hwp'
      && entitlement.source_order_id
    ))
    .map((entitlement) => entitlement.source_order_id!)

  if (hwpSourceOrderIds.length === 0) {
    return false
  }

  const { data: hwpOrders, error: hwpOrderError } = await supabase
    .from('market_purchase_orders')
    .select('id, original_price_credits, charged_credits')
    .in('id', Array.from(new Set(hwpSourceOrderIds)))

  if (hwpOrderError) {
    throw new Error(hwpOrderError.message)
  }

  return (hwpOrders ?? []).some((order) => order.original_price_credits > order.charged_credits)
}

// 배치 조회용 스냅샷 빌더 — loadRefundTarget의 필드 매핑과 반드시 일치해야 한다.
export function buildRefundTargetSnapshotFromPurchase(
  purchase: Tables<'market_purchases'>
): MarketRefundTargetSnapshot {
  return {
    targetKind: 'legacy_purchase',
    targetId: purchase.id,
    userId: purchase.user_id,
    itemId: purchase.item_id,
    workspaceSubject: normalizeWorkspaceSubject((purchase as { workspace_subject?: string | null }).workspace_subject),
    purchasedAt: purchase.purchased_at,
    status: purchase.status,
    refundCredits: purchase.price_credits,
    creditConsumptions: parseCreditConsumptions(purchase.credit_consumptions),
  }
}

export function buildRefundTargetSnapshotFromOrder(
  order: Tables<'market_purchase_orders'>
): MarketRefundTargetSnapshot {
  return {
    targetKind: 'v2_order',
    targetId: order.id,
    userId: order.user_id,
    itemId: order.item_id,
    workspaceSubject: normalizeWorkspaceSubject(order.workspace_subject),
    purchasedAt: order.created_at,
    status: order.status,
    refundCredits: order.charged_credits,
    creditConsumptions: parseCreditConsumptions(order.credit_consumptions),
  }
}

export async function getMarketRefundEligibility(
  input: MarketRefundRequestInput,
  options: MarketRefundEligibilityOptions = {}
): Promise<MarketRefundEligibility> {
  const target = options.preloaded?.target ?? await loadRefundTarget(input)
  const downloadCount = options.preloaded?.downloadCount
    ?? await countDownloads(input.targetKind, input.targetId)
  const requestStatus = options.ignoreRequestStatus
    ? undefined
    : options.preloaded && 'latestRequestStatus' in options.preloaded
      ? options.preloaded.latestRequestStatus ?? undefined
      : await getLatestRequestStatus(input.targetKind, input.targetId)
  const purchasedAt = new Date(target.purchasedAt)
  const refundDeadline = addDays(purchasedAt, 7)
  const isWithinRefundPeriod = new Date() <= refundDeadline
  let status: MarketRefundEligibility['status'] = 'available'
  let reason: string | null = null

  if (requestStatus && requestStatus !== 'rejected' && requestStatus !== 'canceled' && requestStatus !== 'failed') {
    status = requestStatus
    reason = requestStatus === 'pending' ? '이미 환불 요청이 접수되어 심사 중입니다.' : '이미 처리된 환불 요청입니다.'
  } else if (target.status !== 'completed') {
    status = 'blocked'
    reason = '완료된 구매 내역만 환불 요청할 수 있습니다.'
  } else if (downloadCount > 0 || !isWithinRefundPeriod) {
    status = 'blocked'
    reason = downloadCount > 0
      ? '다운로드 이력이 있는 상품은 환불할 수 없습니다.'
      : '구매 후 7일이 지난 상품은 환불할 수 없습니다.'
  } else if (await isUpgradeBaseOrder(input.targetKind, input.targetId, target.userId, target.itemId)) {
    status = 'blocked'
    reason = '이 구매를 기준으로 문제(HWP) 차액 업그레이드가 진행되어 환불할 수 없습니다.'
  } else if (target.creditConsumptions.length === 0) {
    status = 'blocked'
    reason = '크레딧 차감 스냅샷이 없어 자동 환불할 수 없습니다. 고객센터로 문의해주세요.'
  }

  return {
    targetKind: input.targetKind,
    targetId: input.targetId,
    userId: target.userId,
    itemId: target.itemId,
    workspaceSubject: target.workspaceSubject,
    purchasedAt: target.purchasedAt,
    refundDeadline: refundDeadline.toISOString(),
    requestedRefundCredits: target.refundCredits,
    downloadCount,
    status,
    refundable: status === 'available',
    reason,
    creditConsumptions: target.creditConsumptions,
  }
}

export async function hasPendingMarketRefundRequestForTarget(input: {
  targetKind: MarketRefundTargetKind
  legacyPurchaseId?: string | null
  orderId?: string | null
}) {
  const supabase = createAdminClient()
  const query = input.targetKind === 'v2_order'
    ? supabase
      .from('market_refund_requests')
      .select('id')
      .eq('target_kind', 'v2_order')
      .eq('order_id', input.orderId ?? '')
    : supabase
      .from('market_refund_requests')
      .select('id')
      .eq('target_kind', 'legacy_purchase')
      .eq('legacy_purchase_id', input.legacyPurchaseId ?? '')

  const { data, error } = await query
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

export async function requestMarketRefund(input: MarketRefundRequestInput): Promise<MarketRefundRequest> {
  const supabase = createAdminClient()
  const eligibility = await getMarketRefundEligibility(input)

  if (!eligibility.refundable) {
    const error = new Error(eligibility.reason ?? '환불 요청할 수 없는 구매 내역입니다.')
    error.name = eligibility.downloadCount > 0 ? 'DOWNLOAD_EXISTS' : 'REFUND_NOT_ALLOWED'
    throw error
  }

  const { data, error } = await supabase
    .from('market_refund_requests')
    .insert({
      workspace_subject: eligibility.workspaceSubject,
      user_id: eligibility.userId,
      item_id: eligibility.itemId,
      target_kind: eligibility.targetKind,
      legacy_purchase_id: eligibility.targetKind === 'legacy_purchase' ? eligibility.targetId : null,
      order_id: eligibility.targetKind === 'v2_order' ? eligibility.targetId : null,
      requested_refund_credits: eligibility.requestedRefundCredits,
      status: 'pending',
      reason: input.reason ?? null,
      eligibility_snapshot: eligibility as unknown as Json,
    } satisfies TablesInsert<'market_refund_requests'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function listMarketRefundRequestsForAdmin(input: {
  workspaceSubject?: WorkspaceSubject
  status?: string | null
} = {}) {
  const supabase = createAdminClient()
  let query = supabase
    .from('market_refund_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (input.workspaceSubject) {
    query = query.eq('workspace_subject', input.workspaceSubject)
  }

  if (input.status && input.status !== 'all') {
    query = query.eq('status', input.status)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

async function getRefundRequest(requestId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_refund_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error('환불 요청을 찾을 수 없습니다.')
  }

  return data
}

export async function approveMarketRefund(input: MarketRefundProcessInput): Promise<MarketRefundRequest> {
  const supabase = createAdminClient()
  const request = await getRefundRequest(input.requestId)
  if (request.status !== 'pending') {
    throw new Error('대기 중인 환불 요청만 승인할 수 있습니다.')
  }

  const targetId = request.target_kind === 'v2_order' ? request.order_id : request.legacy_purchase_id
  if (!targetId) {
    throw new Error('환불 대상 구매 정보가 없습니다.')
  }

  const eligibility = await getMarketRefundEligibility({
    userId: request.user_id,
    targetKind: request.target_kind as MarketRefundTargetKind,
    targetId,
  }, {
    ignoreRequestStatus: true,
  })
  if (!eligibility.refundable) {
    throw new Error(`승인 전 환불 조건이 변경되었습니다. ${eligibility.reason ?? '환불 요청을 승인할 수 없습니다.'}`)
  }

  await CreditService.refundCredits(
    request.user_id,
    request.requested_refund_credits,
    'market_refund',
    request.id,
    '문제마켓 구매 환불',
    eligibility.creditConsumptions
  )

  if (request.target_kind === 'v2_order') {
    const updateResults = await Promise.all([
      supabase.from('market_purchase_orders').update({ status: 'refunded' }).eq('id', targetId),
      supabase.from('market_purchase_lines').update({ status: 'refunded' }).eq('order_id', targetId),
      supabase.from('market_entitlements').update({ status: 'refunded' }).eq('source_order_id', targetId),
    ])
    const updateError = updateResults.find((result) => result.error)?.error
    if (updateError) {
      throw new Error(updateError.message)
    }
  } else {
    const { error } = await supabase
      .from('market_purchases')
      .update({ status: 'refunded', refunded_at: new Date().toISOString() })
      .eq('id', targetId)

    if (error) {
      throw new Error(error.message)
    }
  }

  const { data, error } = await supabase
    .from('market_refund_requests')
    .update({
      status: 'approved',
      approved_refund_credits: request.requested_refund_credits,
      admin_note: input.adminNote ?? null,
      processed_by: input.adminId,
      processed_at: new Date().toISOString(),
    })
    .eq('id', input.requestId)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function rejectMarketRefund(input: MarketRefundProcessInput): Promise<MarketRefundRequest> {
  const supabase = createAdminClient()
  const request = await getRefundRequest(input.requestId)
  if (request.status !== 'pending') {
    throw new Error('대기 중인 환불 요청만 거부할 수 있습니다.')
  }

  const { data, error } = await supabase
    .from('market_refund_requests')
    .update({
      status: 'rejected',
      admin_note: input.adminNote ?? null,
      processed_by: input.adminId,
      processed_at: new Date().toISOString(),
    })
    .eq('id', input.requestId)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}
