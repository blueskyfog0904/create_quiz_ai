import { CreditService } from '@/lib/credits'
import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { Json, Tables, TablesInsert } from '@/types/supabase'

type MarketRefundRequest = Tables<'market_refund_requests'>
type MarketRefundTargetKind = 'legacy_purchase' | 'v2_order'
type MarketRefundRequestStatus = 'pending' | 'approved' | 'rejected' | 'canceled' | 'failed'

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

interface MarketRefundEligibilityOptions {
  ignoreRequestStatus?: boolean
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

export async function getMarketRefundEligibility(
  input: MarketRefundRequestInput,
  options: MarketRefundEligibilityOptions = {}
): Promise<MarketRefundEligibility> {
  const target = await loadRefundTarget(input)
  const downloadCount = await countDownloads(input.targetKind, input.targetId)
  const requestStatus = options.ignoreRequestStatus
    ? undefined
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
  } else if (downloadCount > 0 && !isWithinRefundPeriod) {
    status = 'blocked'
    reason = '구매 후 7일이 지났고 다운로드 이력이 있는 상품은 환불할 수 없습니다.'
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
    error.name = eligibility.downloadCount > 0 && new Date() > new Date(eligibility.refundDeadline) ? 'DOWNLOAD_EXISTS' : 'REFUND_NOT_ALLOWED'
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
