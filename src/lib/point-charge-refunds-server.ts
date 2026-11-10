import 'server-only'

import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import type { Database, Json } from '@/types/supabase'

type RefundRpcName =
  | 'get_point_charge_refund_eligibility'
  | 'request_point_charge_refund'
  | 'claim_point_charge_refund'
  | 'finalize_point_charge_refund'
  | 'fail_point_charge_refund'
  | 'reject_point_charge_refund'
  | 'quarantine_external_provider_cancellation'
  | 'record_kakaopay_partial_cancel_marker'
  | 'quarantine_kakaopay_partial_cancellation'
  | 'complete_manual_point_charge_refund'

interface RefundRpcErrorInput {
  code?: string
  message?: string
}

const RETRYABLE_DATABASE_ERRORS = ['40P01', '40001', '55P03', '57014']

// 함수가 RAISE한 업무 오류가 아니면(잠금·시간 초과·연결·네트워크) 다시 시도할 수 있다.
function isRetryableRpcError(error: RefundRpcErrorInput) {
  const code = error.code ?? ''
  return !code ||
    RETRYABLE_DATABASE_ERRORS.includes(code) ||
    code.startsWith('08') ||
    code.startsWith('PGRST')
}

// 화면에는 정리된 문구를 보여 주되, 처리기가 영구 실패와 일시 오류를 구분하도록 원래 코드를 남긴다.
export class RefundRpcError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(error: RefundRpcErrorInput) {
    super(getRefundRpcMessage(error))
    this.name = 'RefundRpcError'
    this.code = getRefundRpcCode(error)
    this.retryable = isRetryableRpcError(error)
  }
}

interface RefundRequestResult {
  request_id: string
  refund_amount: number
  refundable_until: string
}

interface RefundEligibilityResult {
  allowed: boolean
  reason_code: string | null
  refundable_until: string | null
}

export interface PointChargeRefundEligibility {
  allowed: boolean
  reason: string | null
  refundableUntil: string | null
}

export interface ClaimedPointChargeRefund {
  already_completed: boolean
  request_id: string
  user_id?: string
  // 'toss'는 과거 결제 이력용이다.
  provider?: 'kakaopay' | 'payapp' | 'toss'
  payment_order_id?: string
  provider_order_id?: string
  payment_key?: string
  provider_transaction_id?: string
  provider_approval_id?: string
  provider_merchant_id?: string
  partner_order_id?: string
  partner_user_id?: string
  cancel_idempotency_key?: string
  refund_amount?: number
  tax_free_amount?: number
  vat_amount?: number
  // 관리자가 결제를 확인한 주문은 자동 취소하지 않고 수동 확인으로 보낸다.
  manual_review_required?: boolean
}

interface FinalizedPointChargeRefund {
  already_completed: boolean
  new_balance: number
}

interface QuarantinedExternalCancellation {
  already_completed: boolean
  already_quarantined: boolean
  request_id: string
  credits_used: boolean
  used_credit_amount: number
}

async function callRefundRpc<T>(
  functionName: RefundRpcName,
  params: Database['public']['Functions'][RefundRpcName]['Args']
) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin.rpc(functionName, params)

  if (error) {
    throw new RefundRpcError(error)
  }

  return (Array.isArray(data) ? data[0] : data) as T
}

const knownRefundRpcMessages: Record<string, string> = {
    REFUND_SOURCE_NOT_FOUND: '구매건을 찾을 수 없습니다.',
    REFUND_PAID_SOURCE_REQUIRED: '결제로 충전한 크레딧만 환불할 수 있습니다.',
    REFUND_COMPLETED_PAYMENT_REQUIRED: '원 결제를 확인할 수 없어 환불을 요청할 수 없습니다.',
    REFUND_SOURCE_NOT_ACTIVE: '이미 환불 처리 중이거나 완료된 구매건입니다.',
    REFUND_CREDITS_ALREADY_USED: '이미 사용한 크레딧이 있어 환불할 수 없습니다.',
    REFUND_SOURCE_EXPIRED: '사용기한이 만료된 크레딧은 환불할 수 없습니다.',
    REFUND_REQUEST_PERIOD_EXPIRED: '구매 후 7일이 지나 환불을 요청할 수 없습니다.',
    REFUND_REQUEST_NOT_CLAIMABLE: '다른 관리자가 처리 중이거나 완료된 요청입니다.',
    REFUND_REQUEST_REVALIDATION_FAILED: '환불 조건이 변경되어 다시 확인해야 합니다.',
    REFUND_REQUEST_NOT_REJECTABLE: '현재 거절할 수 없는 환불 요청입니다.',
    REFUND_REJECT_CONFIRMATION_REQUIRED: '수동 확인 환불을 거절하려면 결제사 미취소 확인과 처리 메모가 모두 필요합니다.',
    REFUND_REQUEST_NOT_FOUND: '환불 요청을 찾을 수 없습니다.',
    REFUND_REQUIRES_MANUAL_COMPLETION: '부분취소된 결제는 수동 환불 완료로만 처리할 수 있습니다.',
    MANUAL_REFUND_MARKER_PENDING: '처리되지 않은 부분취소가 있어 잠시 후 다시 완료해야 합니다.',
    MANUAL_REFUND_INPUT_INVALID: '처리 메모, 외부 처리 방식, 실제 환불 금액을 확인해 주세요.',
    MANUAL_REFUND_NOT_ALLOWED: '수동 확인 중인 환불 요청만 수동 완료할 수 있습니다.',
    MANUAL_REFUND_REVALIDATION_FAILED: '환불 상태가 바뀌었거나 환불액이 결제 금액을 넘습니다. 새로고침 후 다시 확인해 주세요.',
    MANUAL_REFUND_RECOVERY_INVALID: '부분취소 건은 회수할 크레딧(0 이상 남은 크레딧 이하)이 필요하고, 그 밖의 건은 남은 크레딧을 모두 회수합니다.',
}

function getKnownRefundRpcCode(error: RefundRpcErrorInput) {
  const message = error.message ?? ''
  return Object.keys(knownRefundRpcMessages).find((key) => message.includes(key))
}

function getRefundRpcCode(error: RefundRpcErrorInput) {
  return getKnownRefundRpcCode(error) ??
    (error.message?.match(/^[A-Z][A-Z0-9_]{3,}/)?.[0] || error.code || 'REFUND_RPC_FAILED')
}

function getRefundRpcMessage(error: RefundRpcErrorInput) {
  const code = getKnownRefundRpcCode(error)
  return code ? knownRefundRpcMessages[code] : '환불 요청을 처리하지 못했습니다.'
}

const refundBlockReasons: Record<string, string> = {
  REFUND_SOURCE_NOT_FOUND: '구매건을 찾을 수 없습니다.',
  REFUND_PAID_SOURCE_REQUIRED: '결제 충전 건만 환불할 수 있습니다.',
  REFUND_COMPLETED_PAYMENT_REQUIRED: '원 결제를 확인할 수 없습니다.',
  REFUND_SOURCE_NOT_ACTIVE: '환불 처리 중이거나 완료된 구매건입니다.',
  REFUND_CREDITS_ALREADY_USED: '이미 사용한 크레딧이 있습니다.',
  REFUND_SOURCE_EXPIRED: '사용기한이 만료되었습니다.',
  REFUND_REQUEST_PERIOD_EXPIRED: '구매 후 7일이 지났습니다.',
}

export async function getPointChargeRefundEligibility(input: {
  userId: string
  sourceId: string
}): Promise<PointChargeRefundEligibility> {
  const result = await callRefundRpc<RefundEligibilityResult>(
    'get_point_charge_refund_eligibility',
    {
      p_user_id: input.userId,
      p_source_id: input.sourceId,
    }
  )

  return {
    allowed: result.allowed,
    reason: result.reason_code
      ? refundBlockReasons[result.reason_code] ??
        '환불 조건을 확인할 수 없습니다.'
      : null,
    refundableUntil: result.refundable_until,
  }
}

export function requestPointChargeRefund(input: {
  userId: string
  sourceId: string
  reason: string
}) {
  return callRefundRpc<RefundRequestResult>('request_point_charge_refund', {
    p_user_id: input.userId,
    p_source_id: input.sourceId,
    p_reason: input.reason,
  })
}

export function claimPointChargeRefund(input: {
  requestId: string
  adminId: string
  adminNote: string | null
}) {
  return callRefundRpc<ClaimedPointChargeRefund>('claim_point_charge_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_admin_note: input.adminNote ?? '',
  })
}

export function finalizePointChargeRefund(input: {
  requestId: string
  cancelTransactionKey: string
  cancelledAt: string
  providerStatus: string
}) {
  return callRefundRpc<FinalizedPointChargeRefund>('finalize_point_charge_refund', {
    p_request_id: input.requestId,
    p_provider_cancel_transaction_key: input.cancelTransactionKey,
    p_provider_cancelled_at: input.cancelledAt,
    p_provider_status: input.providerStatus,
  })
}

export async function failPointChargeRefund(input: {
  requestId: string
  code: string
  message: string
  retryable: boolean
}) {
  await callRefundRpc<null>('fail_point_charge_refund', {
    p_request_id: input.requestId,
    p_error_code: input.code,
    p_error_message: input.message,
    p_retryable: input.retryable,
  })
}

export async function rejectPointChargeRefund(input: {
  requestId: string
  adminId: string
  adminNote: string | null
  providerNotCancelledConfirmed: boolean
}) {
  await callRefundRpc<null>('reject_point_charge_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_admin_note: input.adminNote ?? '',
    p_provider_not_cancelled_confirmed: input.providerNotCancelledConfirmed,
  })
}

export function quarantineExternalProviderCancellation(input: {
  paymentOrderId: string
  cancelTransactionKey: string
  cancelledAt: string
  providerStatus: string
}) {
  return callRefundRpc<QuarantinedExternalCancellation>(
    'quarantine_external_provider_cancellation',
    {
      p_payment_order_id: input.paymentOrderId,
      p_provider_cancel_transaction_key: input.cancelTransactionKey,
      p_provider_cancelled_at: input.cancelledAt,
      p_provider_status: input.providerStatus,
    }
  )
}

export function recordKakaoPayPartialCancelMarker(input: {
  paymentOrderId: string
  providerStatus: string
}) {
  return callRefundRpc<Json>('record_kakaopay_partial_cancel_marker', {
    p_payment_order_id: input.paymentOrderId,
    p_provider_status: input.providerStatus,
  })
}

export interface QuarantinedKakaoPayPartialCancellation {
  outcome: 'manual_review' | 'already_completed' | 'already_processed'
  already_quarantined: boolean
  credits_used: boolean
  state_unexpected?: boolean
  cancelled_amount_invalid?: boolean
}

// 생성 타입은 null 인자를 표현하지 못하지만 RPC는 취소 금액 NULL을 받는다.
export function quarantineKakaoPayPartialCancellation(input: {
  paymentOrderId: string
  providerStatus: string
  cancelledAmount: number | null
}) {
  return callRefundRpc<QuarantinedKakaoPayPartialCancellation>(
    'quarantine_kakaopay_partial_cancellation',
    {
      p_payment_order_id: input.paymentOrderId,
      p_provider_status: input.providerStatus,
      p_cancelled_amount: input.cancelledAmount as number,
    }
  )
}

export function completeManualPointChargeRefund(input: {
  requestId: string
  adminId: string
  note: string
  externalMethod: string
  refundAmount: number
  recoveredCredits: number | null
}) {
  return callRefundRpc<Json>('complete_manual_point_charge_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_note: input.note,
    p_external_method: input.externalMethod,
    p_refund_amount: input.refundAmount,
    ...(input.recoveredCredits === null ? {} : { p_recovered_credits: input.recoveredCredits }),
  })
}
