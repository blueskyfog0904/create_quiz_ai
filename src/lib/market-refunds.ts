import { reportCreditBalanceAfterMutation } from '@/lib/credits'
import { fillMarketRefundDays } from '@/lib/market-purchase-policy'
import { buildPendingMarketRefundScopes, isWithinMarketRefundPeriod, marketRefundDeadline, type PendingMarketRefundScope } from '@/lib/market-refund-rules'
import {
  getMarketRefundPolicyCached,
  readMarketRefundPolicyUncached,
  type MarketRefundPolicy,
} from '@/lib/market-purchase-policy-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { Database, Json, Tables, TablesInsert } from '@/types/supabase'

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
  // 환불 기간 설정을 읽지 못했으면 null
  refundDeadline: string | null
  requestedRefundCredits: number
  downloadCount: number
  // unavailable: 기간 판정이 필요한데 환불 기간 설정을 읽지 못함(신청 불가, 잠시 후 다시)
  status: 'available' | 'blocked' | 'unavailable' | MarketRefundRequestStatus
  refundable: boolean
  reason: string | null
  // 차액 구매(HWP)의 기준 PDF 주문이라 막혔으면 그 차액 구매 주문 id(그 주문을 신청할 때 함께 신청할 수 있음)
  upgradeOrderIds: string[]
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

export interface MarketRefundApproveInput extends MarketRefundProcessInput {
  // 부족분 안내를 본 관리자가 확인한 복구량. DB가 잠금 아래 다시 계산한 값과 같아야 승인된다.
  confirmedRefundCredits?: number
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
  // 8번: 이미 승인된 환불의 명목 누계(일부 환불된 주문은 전체 환불 대상이 아니다)
  refundCommittedCredits: number
  creditConsumptions: CreditConsumptionSnapshot[]
}

interface MarketRefundEligibilityOptions {
  // 환불 기간·기간 지남 안내(DB system_settings 'market_purchase_policy'). 부르는 쪽이 요청당 한 번 읽어 넘긴다. 못 읽었으면 null.
  refundPolicy: MarketRefundPolicy | null
  // 기간 판정 기준 시각(관리자 승인은 신청 시각). 없으면 지금.
  judgeAt?: Date
  ignoreRequestStatus?: boolean
  // 업그레이드(HWP 차액) 주문에 대기·승인 환불 요청이 있으면 기준 PDF 주문 신청을 허용한다(신청 생성 때만 — 승인은 엄격).
  allowPendingUpgradeRefund?: boolean
  // 배치 조회한 값으로 개별 왕복(loadRefundTarget/countDownloads/getLatestRequestStatus)을 생략한다.
  // latestRequestStatus는 null이 "요청 없음 확인됨"을 의미한다 (키 부재 시 개별 조회).
  preloaded?: {
    target?: MarketRefundTargetSnapshot
    downloadCount?: number
    latestRequestStatus?: MarketRefundRequestStatus | null
  }
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
      refundCommittedCredits: 0,
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
    refundCommittedCredits: data.refund_committed_credits ?? 0,
    creditConsumptions: parseCreditConsumptions(data.credit_consumptions),
  }
}

// PDF 구매를 기준으로 HWP 차액 업그레이드가 이뤄진 경우, 기준이 된 PDF 주문의 환불을 막는다.
// (환불 허용 시 사용자가 차액만 내고 HWP+PDF 전체를 보유하는 루프홀이 생김.
//  차액 주문 여부는 original_price_credits > charged_credits 마커로 판별.)
// 이 주문을 기준으로 한 차액 구매(HWP) 주문 중 아직 환불 신청되지 않아 이 주문을 막는 것들(없으면 빈 배열)
async function upgradeBlockingOrderIds(
  targetKind: MarketRefundTargetKind,
  orderId: string,
  userId: string,
  itemId: string,
  allowPendingUpgradeRefund = false
): Promise<string[]> {
  if (targetKind !== 'v2_order') {
    return []
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
    return []
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
    return []
  }

  const hwpSourceOrderIds = (userEntitlements ?? [])
    .filter((entitlement) => (
      entitlement.subproduct_id
      && slugBySubproductId.get(entitlement.subproduct_id) === 'question_hwp'
      && entitlement.source_order_id
    ))
    .map((entitlement) => entitlement.source_order_id!)

  if (hwpSourceOrderIds.length === 0) {
    return []
  }

  const { data: hwpOrders, error: hwpOrderError } = await supabase
    .from('market_purchase_orders')
    .select('id, original_price_credits, charged_credits')
    .in('id', Array.from(new Set(hwpSourceOrderIds)))

  if (hwpOrderError) {
    throw new Error(hwpOrderError.message)
  }

  const upgradeOrderIds = (hwpOrders ?? [])
    .filter((order) => order.original_price_credits > order.charged_credits)
    .map((order) => order.id)
  if (upgradeOrderIds.length === 0) {
    return []
  }
  if (!allowPendingUpgradeRefund) {
    return upgradeOrderIds
  }
  // 신청 생성 때: 업그레이드 주문마다 대기·승인 환불 요청이 있으면 함께 신청한 것으로 보고 허용한다(승인은 DB 가 U 먼저를 강제).
  const { data: upgradeRequests, error: upgradeRequestError } = await supabase
    .from('market_refund_requests')
    .select('order_id')
    .in('order_id', upgradeOrderIds)
    .in('status', ['pending', 'approved'])
  if (upgradeRequestError) {
    throw new Error(upgradeRequestError.message)
  }
  const requested = new Set((upgradeRequests ?? []).map((request) => request.order_id))
  return upgradeOrderIds.filter((id) => !requested.has(id))
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
    refundCommittedCredits: 0,
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
    refundCommittedCredits: order.refund_committed_credits ?? 0,
    creditConsumptions: parseCreditConsumptions(order.credit_consumptions),
  }
}

export async function getMarketRefundEligibility(
  input: MarketRefundRequestInput,
  options: MarketRefundEligibilityOptions
): Promise<MarketRefundEligibility> {
  const target = options.preloaded?.target ?? await loadRefundTarget(input)
  const downloadCount = options.preloaded?.downloadCount
    ?? await countDownloads(input.targetKind, input.targetId)
  const requestStatus = options.ignoreRequestStatus
    ? undefined
    : options.preloaded && 'latestRequestStatus' in options.preloaded
      ? options.preloaded.latestRequestStatus ?? undefined
      : await getLatestRequestStatus(input.targetKind, input.targetId)
  const refundPolicy = options.refundPolicy
  const refundDeadline = refundPolicy ? marketRefundDeadline(target.purchasedAt, refundPolicy.refundDays) : null
  let status: MarketRefundEligibility['status'] = 'available'
  let reason: string | null = null
  let blockingUpgradeOrderIds: string[] = []

  if (requestStatus && requestStatus !== 'rejected' && requestStatus !== 'canceled' && requestStatus !== 'failed') {
    status = requestStatus
    reason = requestStatus === 'pending' ? '이미 환불 요청이 접수되어 심사 중입니다.' : '이미 처리된 환불 요청입니다.'
  } else if (target.status !== 'completed') {
    status = 'blocked'
    reason = '완료된 구매 내역만 환불 요청할 수 있습니다.'
  } else if (target.refundCommittedCredits > 0) {
    status = 'blocked'
    reason = '이미 일부 환불된 구매입니다. 남은 자료의 환불은 받지 않은 자료 환불이나 고객센터로 신청해 주세요.'
  } else if (downloadCount > 0) {
    status = 'blocked'
    reason = '다운로드 이력이 있는 상품은 환불할 수 없습니다.'
  } else if (!refundPolicy || !refundDeadline) {
    status = 'unavailable'
    reason = '지금은 환불 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.'
  } else if (!isWithinMarketRefundPeriod(target.purchasedAt, refundPolicy.refundDays, options.judgeAt ?? new Date())) {
    status = 'blocked'
    reason = fillMarketRefundDays(refundPolicy.refundExpiredReason, refundPolicy.refundDays)
  } else if ((blockingUpgradeOrderIds = await upgradeBlockingOrderIds(input.targetKind, input.targetId, target.userId, target.itemId, options.allowPendingUpgradeRefund)).length > 0) {
    status = 'blocked'
    reason = '이 PDF로 문제(HWP)를 차액 구매했습니다. 차액 구매(HWP) 주문을 먼저(또는 함께) 환불 신청하면 이 주문도 환불할 수 있습니다.'
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
    refundDeadline: refundDeadline ? refundDeadline.toISOString() : null,
    requestedRefundCredits: target.refundCredits,
    downloadCount,
    status,
    refundable: status === 'available',
    reason,
    upgradeOrderIds: blockingUpgradeOrderIds,
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

// 자료 보관함 목록용 환불 기간 설정(캐시, 읽지 못하면 null). 환불 기간 읽기는 이 모듈을 거친다.
export { getMarketRefundPolicyCached }

// 환불 기간 설정을 읽지 못해 신청·승인을 멈춤(돈이 움직이는 경로라 fail closed). 라우트는 503 REFUND_POLICY_UNAVAILABLE.
export class MarketRefundPolicyUnavailableError extends Error {
  constructor() {
    super('지금은 환불 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.')
    this.name = 'REFUND_POLICY_UNAVAILABLE'
  }
}

export async function requestMarketRefund(input: MarketRefundRequestInput): Promise<MarketRefundRequest> {
  const supabase = createAdminClient()
  // 캐시 없이 매번 읽는다.
  const refundPolicy = await readMarketRefundPolicyUncached()
  if (!refundPolicy) {
    throw new MarketRefundPolicyUnavailableError()
  }
  const eligibility = await getMarketRefundEligibility(input, { refundPolicy, allowPendingUpgradeRefund: true })

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
      refund_kind: 'full',
      claim_channel: 'library',
    } satisfies TablesInsert<'market_refund_requests'>)
    .select('*')
    .single()

  if (error) {
    // 같은 주문 대기 요청 유일 인덱스(동시 신청) — 이미 접수됨
    if (error.code === '23505') {
      throw new MarketRefundConflictError('이미 환불 요청이 접수되어 심사 중입니다.')
    }
    if ((error.message ?? '').includes('MARKET_REFUND_PARTIALLY_REFUNDED')) {
      throw new MarketRefundConflictError('이미 일부 환불된 구매입니다. 남은 자료의 환불은 받지 않은 자료 환불로 신청해 주세요.')
    }
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

// 이미 다른 승인/거부가 처리한 요청. 라우트에서 409로 응답한다.
export class MarketRefundConflictError extends Error {}

// 현금 환불 이력이 있거나 결제 취소가 진행 중인 크레딧으로 산 주문 — 대표 정산으로만 처리한다(8번).
export class MarketRefundNeedsOwnerError extends Error {
  constructor() {
    super('충전 환불 이력이 있는 크레딧으로 산 주문이라 대표 확인이 필요합니다. 대표 계정에서 원천별 정산으로 처리해 주세요.')
    this.name = 'MARKET_REFUND_NEEDS_OWNER'
  }
}

// DB 함수가 jsonb code 로 거절했을 때(8번 새 경로). code 를 그대로 라우트에 넘긴다.
export class MarketRefundRuleError extends Error {
  readonly code: string
  readonly details: unknown
  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = code
    this.code = code
    this.details = details ?? null
  }
}

// 환불됐거나 만료된 원천 때문에 요청량 전부를 되돌릴 수 없다. 라우트에서 409로 응답하고 관리자 확인을 받는다.
export class MarketRefundShortfallError extends Error {
  readonly requested: number
  readonly restorable: number

  constructor(requested: number, restorable: number) {
    super(`원천 한도·소비 기록 문제로 ${requested.toLocaleString()}크레딧 중 ${restorable.toLocaleString()}크레딧만 돌려줄 수 있습니다(유효기간이 지난 몫은 다시 지급에 포함). 확인하면 ${restorable.toLocaleString()}크레딧만 돌려주고 이용권을 회수합니다.`)
    this.requested = requested
    this.restorable = restorable
  }
}

function parseShortfallDetail(details: unknown) {
  try {
    const parsed = JSON.parse(typeof details === 'string' ? details : '') as { requested?: unknown; restorable?: unknown }
    const requested = Number(parsed.requested)
    const restorable = Number(parsed.restorable)
    if (Number.isInteger(requested) && Number.isInteger(restorable)) {
      return { requested, restorable }
    }
  } catch {
    // 형식이 다르면 아래에서 일반 오류로 처리한다.
  }
  return null
}

type ApproveMarketRefundArgs = Database['public']['Functions']['approve_market_refund']['Args']

export async function approveMarketRefund(input: MarketRefundApproveInput): Promise<MarketRefundRequest> {
  const supabase = createAdminClient()
  const request = await getRefundRequest(input.requestId)
  if (request.status !== 'pending') {
    throw new MarketRefundConflictError('대기 중인 환불 요청만 승인할 수 있습니다.')
  }
  // 8번: 부분 환불은 DB 함수가 대상·금액을 다시 판정한다. 대표 확인이 필요한 예외 요청은 대표 정산으로만 닫는다.
  if (request.refund_kind === 'partial') {
    return approvePartialRefundRequest(input)
  }
  if (request.refund_kind === 'exception') {
    throw new MarketRefundNeedsOwnerError()
  }

  const targetId = request.target_kind === 'v2_order' ? request.order_id : request.legacy_purchase_id
  if (!targetId) {
    throw new Error('환불 대상 구매 정보가 없습니다.')
  }

  // 빠른 안내용 사전 검사다. 다운로드·대상 상태·소비 내역은 RPC가 잠금 아래에서 다시 본다.
  // 환불 기간은 RPC 가 보지 않으므로 여기서 본다: 기준은 신청 시각(기간 안에 낸 신청은 늦게 승인해도 통과). 설정은 캐시 없이 읽는다.
  const refundPolicy = await readMarketRefundPolicyUncached()
  if (!refundPolicy) {
    throw new MarketRefundPolicyUnavailableError()
  }
  const requestedAt = typeof request.created_at === 'string' ? new Date(request.created_at) : null
  if (!requestedAt || Number.isNaN(requestedAt.getTime())) {
    throw new Error('환불 신청 시각을 확인할 수 없어 승인하지 않았습니다.')
  }
  const eligibility = await getMarketRefundEligibility({
    userId: request.user_id,
    targetKind: request.target_kind as MarketRefundTargetKind,
    targetId,
  }, {
    refundPolicy,
    judgeAt: requestedAt,
    ignoreRequestStatus: true,
  })
  if (!eligibility.refundable) {
    throw new Error(`승인 전 환불 조건이 변경되었습니다. ${eligibility.reason ?? '환불 요청을 승인할 수 없습니다.'}`)
  }

  // 승인·크레딧 복구·이용권 회수·부족분 경보를 한 트랜잭션으로 처리한다. 실패하면 아무것도 바뀌지 않는다.
  // 생성 타입은 null 인자를 표현하지 못하지만 RPC는 NULL을 받는다.
  const { data, error } = await supabase.rpc('approve_market_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_admin_note: input.adminNote ?? null,
    p_confirmed_refund_credits: input.confirmedRefundCredits ?? null,
  } as unknown as ApproveMarketRefundArgs)

  if (error) {
    const message = error.message ?? ''
    if (message.includes('MARKET_REFUND_NOT_PENDING')) {
      throw new MarketRefundConflictError('이미 처리된 환불 요청입니다.')
    }
    if (message.includes('MARKET_REFUND_TARGET_CHANGED')) {
      throw new Error('승인 전 환불 조건이 변경되었습니다.')
    }
    if (message.includes('MARKET_REFUND_NEEDS_OWNER')) {
      throw new MarketRefundNeedsOwnerError()
    }
    if (message.includes('MARKET_REFUND_UPGRADE_BASE_ORDER')) {
      throw new MarketRefundConflictError('이 PDF로 차액 구매한 문제(HWP) 주문을 먼저 환불해야 승인할 수 있습니다.')
    }
    if (message.includes('MARKET_REFUND_SHORTFALL')) {
      const shortfall = parseShortfallDetail(error.details)
      if (shortfall) {
        throw new MarketRefundShortfallError(shortfall.requested, shortfall.restorable)
      }
    }
    // 같은 사용자의 다른 크레딧 처리와 잠금이 엇갈려 롤백됐다. 아무것도 바뀌지 않았다.
    if (error.code === '40P01' || error.code === '40001') {
      throw new MarketRefundConflictError('다른 처리와 겹쳤습니다. 잠시 후 다시 시도하세요.')
    }
    throw new Error(message || '문제마켓 환불 처리에 실패했습니다.')
  }

  await reportCreditBalanceAfterMutation(request.user_id, 'Market refund')

  return data as unknown as MarketRefundRequest
}

export type MarketRefundRejectCode = 'TARGET_CHANGED' | 'PROVIDED_CONFIRMED' | 'OTHER'
export const MARKET_REFUND_REJECT_CODES: MarketRefundRejectCode[] = ['TARGET_CHANGED', 'PROVIDED_CONFIRMED', 'OTHER']

export interface MarketRefundRejectInput extends MarketRefundProcessInput {
  rejectCode: MarketRefundRejectCode
  // PROVIDED_CONFIRMED 의 근거(연결 문의, 또는 제공 경로·시각). 회원 알림에도 실린다.
  evidence?: string
}

// 거부(8번): 사유 필수, 코드 필수. 요건을 갖춘 신청(부분 신청, 또는 받지 않았고 기간 안인 전체 신청)은
// '판정 근거가 바뀜(TARGET_CHANGED)'이나 '실제로 받은 사실 확인(PROVIDED_CONFIRMED)'일 때만 거부할 수 있다.
export async function rejectMarketRefund(input: MarketRefundRejectInput): Promise<MarketRefundRequest> {
  const supabase = createAdminClient()
  const adminNote = (input.adminNote ?? '').trim()
  if (!adminNote) {
    throw new MarketRefundRuleError('REJECT_REASON_REQUIRED', '거부 사유를 적어 주세요. 회원에게 그대로 안내됩니다.')
  }
  if (!MARKET_REFUND_REJECT_CODES.includes(input.rejectCode)) {
    throw new MarketRefundRuleError('REJECT_CODE_INVALID', '거부 사유 종류를 골라 주세요.')
  }
  const request = await getRefundRequest(input.requestId)
  if (request.status !== 'pending') {
    throw new MarketRefundConflictError('대기 중인 환불 요청만 거부할 수 있습니다.')
  }

  const evidence = (input.evidence ?? '').trim()
  if (input.rejectCode === 'PROVIDED_CONFIRMED' && evidence.length < 5) {
    throw new MarketRefundRuleError('REJECT_EVIDENCE_REQUIRED', '받은 사실의 근거(연결 문의, 또는 제공 경로·시각)를 적어 주세요.')
  }

  if (input.rejectCode === 'OTHER') {
    // 부분 신청과 고객센터로 접수된 받지 않은 자료 환불(예외·withdrawal)은 DB 가 기간·대상을 이미 판정한 요건 충족 신청이다.
    let qualifying = request.refund_kind === 'partial'
      || (request.refund_kind === 'exception' && request.claim_type === 'withdrawal')
    const targetId = request.target_kind === 'v2_order' ? request.order_id : request.legacy_purchase_id
    if (!qualifying && request.refund_kind === 'full' && targetId) {
      const refundPolicy = await readMarketRefundPolicyUncached()
      if (!refundPolicy) {
        // 판정할 수 없으면 재량 거부를 막는다(fail closed).
        throw new MarketRefundRuleError('POLICY_UNAVAILABLE', RULE_MESSAGES.POLICY_UNAVAILABLE)
      }
      const eligibility = await getMarketRefundEligibility({
        userId: request.user_id,
        targetKind: request.target_kind as MarketRefundTargetKind,
        targetId,
      }, { refundPolicy, judgeAt: new Date(request.claim_received_at ?? request.created_at), ignoreRequestStatus: true, allowPendingUpgradeRefund: true })
      qualifying = eligibility.refundable
    }
    if (qualifying) {
      throw new MarketRefundRuleError('REJECT_CODE_NOT_ALLOWED',
        '요건을 갖춘 환불 신청은 "판정 근거가 바뀜" 또는 "실제로 받은 사실 확인"일 때만 거부할 수 있습니다.')
    }
  }

  const { data, error } = await supabase
    .from('market_refund_requests')
    .update({
      status: 'rejected',
      reject_code: input.rejectCode,
      admin_note: input.rejectCode === 'PROVIDED_CONFIRMED' ? `${adminNote}\n(근거: ${evidence})` : adminNote,
      processed_by: input.adminId,
      processed_at: new Date().toISOString(),
    })
    .eq('id', input.requestId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    throw new MarketRefundConflictError('이미 처리된 환불 요청입니다.')
  }

  return data
}

// ── 8번: 패키지 부분 환불·예외 환불·대표 정산 ───────────────────────────────────────────────────────────────
type RuleResult = { ok?: boolean; code?: string; details?: unknown } & Record<string, unknown>

const RULE_MESSAGES: Record<string, string> = {
  NOT_FOUND: '환불할 구매 내역을 찾을 수 없습니다.',
  NOT_ELIGIBLE: '받지 않은 자료 환불은 완료된 전체 패키지 구매에만 신청할 수 있습니다.',
  POLICY_UNAVAILABLE: '지금은 환불 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  REFUND_PERIOD_EXPIRED: '환불 신청 기간이 지났습니다.',
  COMPOSITION_UNKNOWN: '구매 당시 구성을 확인할 수 없어 고객센터로 문의해 주세요.',
  FULL_REFUND_AVAILABLE: '받은 자료가 없어 전체 환불로 신청할 수 있습니다.',
  NOTHING_TO_REFUND: '환불할 수 있는 받지 않은 자료가 없습니다.',
  AMOUNT_CHANGED: '환불 금액이나 대상이 바뀌었습니다. 다시 확인해 주세요.',
  ALREADY_PENDING: '이미 환불 요청이 접수되어 심사 중입니다.',
  PRIOR_NOT_ELIGIBLE: '이어서 신청할 수 있는 앞 신청이 아닙니다.',
  TARGET_CHANGED: '신청 뒤 받은 자료나 금액이 바뀌어 처리하지 못했습니다. 부분 신청은 회원이 다시 신청하고, 고객센터 접수는 예외 환불로 다시 접수하면 처음 시각으로 판단합니다.',
  NEEDS_OWNER: '충전 환불 이력이 있는 크레딧으로 산 주문이라 대표 확인이 필요합니다.',
  CANCEL_IN_PROGRESS: '결제 취소 처리가 아직 진행 중입니다. 결제 취소 처리를 먼저 끝내 주세요.',
  NOT_OWNER_CASE: '대표 정산 대상이 아닙니다. 일반 승인으로 처리해 주세요.',
  OWNER_CONTEXT_STALE: '대표 확인이 필요했던 원인이 그사이 풀렸습니다. 창을 다시 열어 원천 입력 없이 정산해 주세요.',
  ITEMS_INVALID: '원천별 정산 값이 맞지 않습니다. 문제 원천 몫만, 합계가 요청 금액과 같게 입력해 주세요.',
  OWNER_ONLY: '대표 계정만 처리할 수 있습니다.',
  SELF_TARGET: '본인 계정의 주문은 처리할 수 없습니다.',
  FORBIDDEN: '마켓 환불 권한이 없습니다.',
  ADMIN_LIMIT_EXCEEDED: '이 환불은 계정의 1건 한도(주문 누계 기준)를 넘습니다. 대표에게 요청해 주세요.',
  PENDING_REQUEST_EXISTS: '이 주문에 처리 대기 중인 환불 요청이 있습니다. 먼저 처리해 주세요.',
  UPGRADE_BASE_ORDER: '이 PDF로 차액 구매한 문제(HWP) 주문을 먼저 환불해 주세요.',
  TICKET_INVALID: '이 회원의 1:1 문의를 연결해 주세요(구매 뒤 작성된 문의).',
  CLAIM_TIME_INVALID: '접수 시각이 올바르지 않습니다(구매 시각 이후, 지금 이전).',
  ALREADY_DOWNLOADED: '받은 자료가 있어 받지 않은 자료 환불로 처리할 수 없습니다. 하자라면 하자 환불로 처리해 주세요.',
  TARGET_INVALID: '환불할 자료를 골라 주세요(아직 환불되지 않은 구성 자료).',
  INPUT_INVALID: '입력이 올바르지 않습니다.',
  MARKET_REFUND_SHORTFALL: '일부 크레딧을 돌려줄 수 없습니다. 금액을 확인한 뒤 다시 승인해 주세요.',
  KIND_MISMATCH: '요청 종류가 맞지 않습니다.',
  NOT_PENDING: '이미 처리된 환불 요청입니다.',
}

function ruleError(result: RuleResult) {
  const code = String(result.code ?? 'UNKNOWN')
  if (code === 'NEEDS_OWNER') {
    return new MarketRefundNeedsOwnerError()
  }
  if (code === 'MARKET_REFUND_SHORTFALL') {
    const details = (result.details ?? {}) as { requested?: unknown; restorable?: unknown }
    const requested = Number(details.requested)
    const restorable = Number(details.restorable)
    if (Number.isInteger(requested) && Number.isInteger(restorable)) {
      return new MarketRefundShortfallError(requested, restorable)
    }
  }
  return new MarketRefundRuleError(code, RULE_MESSAGES[code] ?? '환불 처리에 실패했습니다.', result.details)
}

function refundRuleDb() {
  return createAdminClient()
}

async function callRefundRule(fn: string, args: Record<string, unknown>): Promise<RuleResult> {
  const { data, error } = await (refundRuleDb() as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  }).rpc(fn, args)
  if (error) {
    if (error.code === '40P01' || error.code === '40001') {
      throw new MarketRefundConflictError('다른 처리와 겹쳤습니다. 잠시 후 다시 시도하세요.')
    }
    throw new Error(error.message || '환불 처리에 실패했습니다.')
  }
  return (data ?? {}) as RuleResult
}

export interface MarketPartialRefundPreview {
  code: string
  amount: number | null
  targets: string[]
  deadline: string | null
  // 앞 신청이 '판정 근거가 바뀜'으로 거부됐으면 그 id(재신청은 처음 신청 시각으로 판정)
  priorRequestId: string | null
  message: string | null
}

// 보관함·관리자 화면용 미리보기(쓰기 없음). 확정은 신청·승인 함수가 다시 판정한다.
export async function previewMarketPartialRefund(userId: string, orderId: string): Promise<MarketPartialRefundPreview> {
  const result = await callRefundRule('preview_market_partial_refund', { p_user_id: userId, p_order_id: orderId })
  const code = String(result.code ?? 'UNKNOWN')
  return {
    code,
    amount: typeof result.amount === 'number' ? result.amount : null,
    targets: Array.isArray(result.targets) ? (result.targets as string[]) : [],
    deadline: typeof result.deadline === 'string' ? result.deadline : null,
    priorRequestId: typeof result.prior_request_id === 'string' ? result.prior_request_id : null,
    message: code === 'OK' ? null : RULE_MESSAGES[code] ?? null,
  }
}

export async function requestMarketPartialRefund(input: {
  userId: string
  orderId: string
  expectedCredits: number
  reason?: string | null
  priorRequestId?: string | null
}) {
  const result = await callRefundRule('request_market_partial_refund', {
    p_user_id: input.userId,
    p_order_id: input.orderId,
    p_expected_credits: input.expectedCredits,
    p_reason: input.reason ?? '',
    p_prior_request_id: input.priorRequestId ?? null,
  })
  if (result.ok !== true) {
    throw ruleError(result)
  }
  return { requestId: String(result.request_id), amount: Number(result.amount), targets: (result.targets ?? []) as string[] }
}

async function approvePartialRefundRequest(input: MarketRefundApproveInput): Promise<MarketRefundRequest> {
  const result = await callRefundRule('approve_market_partial_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_admin_note: input.adminNote ?? null,
    p_confirmed_refund_credits: input.confirmedRefundCredits ?? null,
  })
  if (result.ok !== true) {
    throw ruleError(result)
  }
  const request = result.request as MarketRefundRequest
  await reportCreditBalanceAfterMutation(request.user_id, 'Market refund')
  return request
}

export interface MarketExceptionRefundInput {
  adminId: string
  orderId: string
  claimType: 'defect' | 'withdrawal'
  claimChannel: 'ticket' | 'email' | 'phone' | null
  subproductIds: string[] | null
  expectedCredits: number
  expectedCommitted: number
  reason: string
  supportTicketId: string | null
  ticketRevisionId: string | null
  claimReceivedAt: string | null
  confirmedRefundCredits?: number
}

// 관리자 예외 환불. expectedCredits 를 -1 로 보내면 쓰기 전에 AMOUNT_CHANGED 로 지금 금액·대상을 돌려받는다(미리보기).
export async function exceptionMarketRefund(input: MarketExceptionRefundInput) {
  const result = await callRefundRule('admin_exception_market_refund', {
    p_admin_id: input.adminId,
    p_order_id: input.orderId,
    p_claim_type: input.claimType,
    p_claim_channel: input.claimChannel,
    p_subproduct_ids: input.subproductIds,
    p_expected_credits: input.expectedCredits,
    p_expected_committed: input.expectedCommitted,
    p_reason: input.reason,
    p_support_ticket_id: input.supportTicketId,
    p_ticket_revision_id: input.ticketRevisionId,
    p_claim_received_at: input.claimReceivedAt,
    p_confirmed_refund_credits: input.confirmedRefundCredits ?? null,
  })
  if (result.ok !== true) {
    throw ruleError(result)
  }
  return { requestId: String(result.request_id), amount: Number(result.amount), shortfall: Number(result.shortfall ?? 0) }
}

export interface MarketOwnerSettleItem {
  sourceId: string
  restored: number
  reissued: number
  unrecovered: number
  reason: string
}

export async function settleMarketRefundByOwner(input: {
  requestId: string
  ownerId: string
  items: MarketOwnerSettleItem[]
  note: string
  // 대기 원인이 풀린 예외 요청을 규칙대로 정산할 때, 돌려줄 수 없는 몫을 확인한 값(부족분 안내 뒤 다시 보냄)
  confirmedRefundCredits?: number
}) {
  const result = await callRefundRule('settle_market_refund_by_owner', {
    p_request_id: input.requestId,
    p_owner_id: input.ownerId,
    p_items: input.items.map((item) => ({
      source_id: item.sourceId,
      restored: item.restored,
      reissued: item.reissued,
      unrecovered: item.unrecovered,
      reason: item.reason,
    })),
    p_note: input.note,
    p_confirmed_refund_credits: input.confirmedRefundCredits ?? null,
  })
  if (result.ok !== true) {
    throw ruleError(result)
  }
  return { requestId: String(result.request_id), shortfall: Number(result.shortfall ?? 0) }
}

// 다운로드 차단 범위(8번): 대기 요청이 부분 환불이면 대상 자료(같은 분류의 교체본 포함)만 막는다.
export async function listPendingMarketRefundScopes(orderIds: string[]): Promise<Map<string, PendingMarketRefundScope>> {
  const ids = Array.from(new Set(orderIds.filter(Boolean)))
  if (ids.length === 0) return new Map<string, PendingMarketRefundScope>()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_refund_requests')
    .select('order_id, refund_kind, refund_subproduct_ids')
    .eq('target_kind', 'v2_order')
    .eq('status', 'pending')
    .in('order_id', ids)
  if (error) {
    throw new Error(error.message)
  }
  const targetIds = Array.from(new Set((data ?? []).flatMap((row) => row.refund_subproduct_ids ?? [])))
  const slugBySubproductId = new Map<string, string>()
  if (targetIds.length > 0) {
    const { data: subproducts, error: subproductError } = await supabase
      .from('market_item_subproducts')
      .select('id, market_subproduct_categories(slug)')
      .in('id', targetIds)
    if (subproductError) {
      throw new Error(subproductError.message)
    }
    for (const row of (subproducts ?? []) as Array<{ id: string; market_subproduct_categories: { slug: string } | null }>) {
      if (row.market_subproduct_categories?.slug) slugBySubproductId.set(row.id, row.market_subproduct_categories.slug)
    }
  }
  return buildPendingMarketRefundScopes(data ?? [], (id) => slugBySubproductId.get(id))
}

export interface MarketOrderRefundContext {
  order: {
    id: string
    userId: string
    itemId: string
    itemTitle: string
    purchaseType: string
    status: string
    chargedCredits: number
    committedCredits: number
    refundedCredits: number
    createdAt: string
  }
  composition: Array<{ subproductId: string; title: string; slug: string; listPriceCredits: number; downloaded: boolean; refunded: boolean }>
  downloadCount: number
  hasPendingRequest: boolean
  // 10번: 탈퇴 회원 주문이면 문의(제목·본문)를 읽지 않고 tickets 는 비운다. 화면은 예외 환불 대신 현금 정산 기록으로 바뀐다.
  memberWithdrawn: boolean
  tickets: Array<{
    id: string
    subject: string
    // 지금 판의 본문(관리자가 이 주문의 환불 의사인지 확인)
    message: string
    createdAt: string
    memberUpdatedAt: string | null
    revisions: Array<{ id: string; subject: string | null; message: string | null; writtenAt: string }>
  }>
}

// 회원이 탈퇴(익명화)했는가. 10번 마이그레이션 전(withdrawn_at 칸 없음, 42703)에는 탈퇴 회원이 있을 수 없다.
async function isMemberWithdrawn(supabase: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('withdrawn_at').eq('id', userId).maybeSingle()
  if (error) {
    if (error.code === '42703') return false
    throw new Error(error.message)
  }
  return Boolean(data?.withdrawn_at)
}

// 관리자 예외 환불 대화상자용(표시만 — 대상·금액 확정은 DB 함수가 다시 판정).
export async function getMarketOrderRefundContext(orderId: string): Promise<MarketOrderRefundContext | null> {
  const supabase = createAdminClient()
  const { data: order, error: orderError } = await supabase
    .from('market_purchase_orders')
    .select('id, user_id, item_id, purchase_type, status, charged_credits, refund_committed_credits, refunded_credits, created_at')
    .eq('id', orderId)
    .maybeSingle()
  if (orderError) throw new Error(orderError.message)
  if (!order) return null
  const memberWithdrawn = await isMemberWithdrawn(supabase, order.user_id)

  const [itemResult, componentResult, downloadResult, requestResult, ticketResult] = await Promise.all([
    supabase.from('market_items').select('title').eq('id', order.item_id).maybeSingle(),
    supabase.from('market_bundle_line_components').select('subproduct_id, category_slug, list_price_credits').eq('order_id', orderId),
    supabase.from('market_download_events').select('subproduct_file_id').eq('order_id', orderId),
    supabase.from('market_refund_requests').select('status, refund_kind, refund_subproduct_ids').eq('order_id', orderId),
    memberWithdrawn
      ? Promise.resolve({ data: [] as Array<{ id: string; subject: string; message: string | null; created_at: string; member_updated_at: string | null }>, error: null })
      : supabase.from('support_tickets').select('id, subject, message, created_at, member_updated_at').eq('user_id', order.user_id)
        .gte('created_at', order.created_at).order('created_at', { ascending: false }).limit(20),
  ])
  for (const result of [itemResult, componentResult, downloadResult, requestResult, ticketResult]) {
    if (result.error) throw new Error(result.error.message)
  }
  const components = componentResult.data ?? []
  const fileIds = Array.from(new Set((downloadResult.data ?? []).map((row) => row.subproduct_file_id).filter((id): id is string => Boolean(id))))
  const { data: files, error: fileError } = fileIds.length > 0
    ? await supabase.from('market_subproduct_files').select('id, subproduct_id').in('id', fileIds)
    : { data: [], error: null }
  if (fileError) throw new Error(fileError.message)
  const subproductIds = Array.from(new Set([...components.map((row) => row.subproduct_id), ...(files ?? []).map((row) => row.subproduct_id)]))
  const { data: subproducts, error: subproductError } = subproductIds.length > 0
    ? await supabase.from('market_item_subproducts').select('id, title, market_subproduct_categories(name, slug)').in('id', subproductIds)
    : { data: [], error: null }
  if (subproductError) throw new Error(subproductError.message)
  const subproductRows = (subproducts ?? []) as Array<{ id: string; title: string | null; market_subproduct_categories: { name: string; slug: string } | null }>
  const slugById = new Map(subproductRows.map((row) => [row.id, row.market_subproduct_categories?.slug ?? null]))
  const titleById = new Map(subproductRows.map((row) => [row.id, row.market_subproduct_categories?.name ?? row.title ?? '자료']))
  const downloadedSlugs = new Set((files ?? []).map((row) => slugById.get(row.subproduct_id)).filter((slug): slug is string => Boolean(slug)))
  const approved = (requestResult.data ?? []).filter((row) => row.status === 'approved')
  const refundedIds = new Set(approved.some((row) => row.refund_kind === 'full')
    ? components.map((row) => row.subproduct_id)
    : approved.flatMap((row) => row.refund_subproduct_ids ?? []))

  const tickets = ticketResult.data ?? []
  const ticketIds = tickets.map((ticket) => ticket.id)
  const { data: revisions, error: revisionError } = ticketIds.length > 0
    ? await supabase.from('support_ticket_revisions').select('id, ticket_id, subject, message, written_at').in('ticket_id', ticketIds)
    : { data: [], error: null }
  if (revisionError) throw new Error(revisionError.message)
  const revisionRows = revisions ?? []

  return {
    order: {
      id: order.id,
      userId: order.user_id,
      itemId: order.item_id,
      itemTitle: itemResult.data?.title ?? '문제마켓 상품',
      purchaseType: order.purchase_type,
      status: order.status,
      chargedCredits: order.charged_credits,
      committedCredits: order.refund_committed_credits ?? 0,
      refundedCredits: order.refunded_credits ?? 0,
      createdAt: order.created_at,
    },
    composition: components.map((row) => ({
      subproductId: row.subproduct_id,
      title: titleById.get(row.subproduct_id) ?? row.category_slug,
      slug: row.category_slug,
      listPriceCredits: row.list_price_credits,
      downloaded: downloadedSlugs.has(row.category_slug),
      refunded: refundedIds.has(row.subproduct_id),
    })),
    downloadCount: (downloadResult.data ?? []).length,
    hasPendingRequest: (requestResult.data ?? []).some((row) => row.status === 'pending'),
    memberWithdrawn,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      message: ticket.message ?? '',
      createdAt: ticket.created_at,
      memberUpdatedAt: ticket.member_updated_at ?? null,
      revisions: revisionRows.filter((row) => row.ticket_id === ticket.id)
        .map((row) => ({ id: row.id, subject: row.subject, message: row.message, writtenAt: row.written_at })),
    })),
  }
}

export interface MarketRefundOwnerSource {
  sourceId: string
  category: string
  status: string
  expiresAt: string | null
  remainingConsumed: number
  cashRefunded: boolean
  refundOpen: boolean
  cancelInProgress: boolean
  needsOwner: boolean
}

// 대표 정산 대화상자용(표시만 — DB 함수가 잠금 아래에서 같은 판정을 다시 한다).
export async function getMarketRefundOwnerContext(requestId: string) {
  const supabase = createAdminClient()
  const request = await getRefundRequest(requestId)
  if (!request.order_id) return null
  const { data: order, error: orderError } = await supabase
    .from('market_purchase_orders').select('id, credit_consumptions, charged_credits, refund_committed_credits').eq('id', request.order_id).maybeSingle()
  if (orderError) throw new Error(orderError.message)
  if (!order) return null
  const consumed = new Map<string, number>()
  for (const entry of parseCreditConsumptions(order.credit_consumptions)) {
    consumed.set(entry.sourceId, (consumed.get(entry.sourceId) ?? 0) + entry.amount)
  }
  const { data: approved, error: approvedError } = await supabase
    .from('market_refund_requests').select('allocated_items').eq('order_id', order.id).eq('status', 'approved')
  if (approvedError) throw new Error(approvedError.message)
  for (const row of approved ?? []) {
    for (const item of (Array.isArray(row.allocated_items) ? row.allocated_items : []) as Array<{ source_id?: string | null; taken?: number }>) {
      if (item.source_id && consumed.has(item.source_id)) {
        consumed.set(item.source_id, Math.max((consumed.get(item.source_id) ?? 0) - Number(item.taken ?? 0), 0))
      }
    }
  }
  const sourceIds = Array.from(consumed.keys())
  const [sourceResult, cashResult] = await Promise.all([
    sourceIds.length > 0
      ? supabase.from('credit_sources').select('id, source_category, status, expires_at, payment_order_id').in('id', sourceIds)
      : Promise.resolve({ data: [], error: null }),
    sourceIds.length > 0
      ? supabase.from('refund_requests').select('source_id, status, payment_order_id, created_at').in('source_id', sourceIds).order('created_at')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (sourceResult.error) throw new Error(sourceResult.error.message)
  if (cashResult.error) throw new Error(cashResult.error.message)
  const cashRows = (cashResult.data ?? []) as Array<{ source_id: string; status: string; payment_order_id: string | null }>
  const sourceRows = (sourceResult.data ?? []) as Array<{ id: string; source_category: string; status: string; expires_at: string | null; payment_order_id: string | null }>
  // DB market_refund_allocate 와 같은 결제 주문 찾기(원천의 결제 주문, 없으면 충전 환불 요청의 결제 주문)와 처리 안 된 취소 표시
  const paymentOrderOf = (source: (typeof sourceRows)[number]) => source.payment_order_id
    ?? cashRows.find((row) => row.source_id === source.id && row.payment_order_id)?.payment_order_id ?? null
  const paymentOrderIds = Array.from(new Set(sourceRows.map(paymentOrderOf).filter((id): id is string => Boolean(id))))
  const markerOrderIds = new Set<string>()
  if (paymentOrderIds.length > 0) {
    const { data: markers, error: markerError } = await supabase
      .from('payment_provider_transactions')
      .select('payment_order_id, cancel_feedback_recorded_at, cancel_processed_at, partial_cancel_feedback_recorded_at, partial_cancel_processed_at')
      .in('payment_order_id', paymentOrderIds)
    if (markerError) throw new Error(markerError.message)
    for (const row of markers ?? []) {
      if ((row.cancel_feedback_recorded_at && !row.cancel_processed_at)
        || (row.partial_cancel_feedback_recorded_at && !row.partial_cancel_processed_at)) markerOrderIds.add(row.payment_order_id)
    }
  }
  const sources: MarketRefundOwnerSource[] = sourceRows
    .map((source) => {
      const cashRefunded = cashRows.some((row) => row.source_id === source.id && row.status === 'completed')
      const refundOpen = cashRows.some((row) => row.source_id === source.id && ['pending_review', 'processing', 'retryable_failed', 'manual_review'].includes(row.status))
      const paymentOrderId = paymentOrderOf(source)
      const cancelInProgress = paymentOrderId !== null && markerOrderIds.has(paymentOrderId)
      return {
        sourceId: source.id,
        category: source.source_category,
        status: source.status,
        expiresAt: source.expires_at,
        remainingConsumed: consumed.get(source.id) ?? 0,
        cashRefunded,
        refundOpen,
        cancelInProgress,
        needsOwner: cashRefunded || refundOpen || cancelInProgress || source.status !== 'active',
      }
    })
    .filter((source) => source.remainingConsumed > 0)
  return { requestId, requestedCredits: request.requested_refund_credits, sources }
}
