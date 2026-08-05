import 'server-only'

import { createPaymentAdminClient } from '@/lib/payment-orders-server'

interface RefundRpcError {
  message?: string
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
  payment_order_id?: string
  payment_key?: string
  cancel_idempotency_key?: string
  refund_amount?: number
}

interface FinalizedPointChargeRefund {
  already_completed: boolean
  new_balance: number
}

async function callRefundRpc<T>(
  functionName: string,
  params: Record<string, unknown>
) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin.rpc(functionName, params)

  if (error) {
    throw new Error(getRefundRpcMessage(error))
  }

  return (Array.isArray(data) ? data[0] : data) as T
}

function getRefundRpcMessage(error: RefundRpcError) {
  const message = error.message ?? ''
  const knownMessages: Record<string, string> = {
    REFUND_SOURCE_NOT_FOUND: '구매건을 찾을 수 없습니다.',
    REFUND_PAID_SOURCE_REQUIRED: '토스페이먼츠로 충전한 크레딧만 환불할 수 있습니다.',
    REFUND_COMPLETED_TOSS_PAYMENT_REQUIRED: '원 결제를 확인할 수 없어 환불을 요청할 수 없습니다.',
    REFUND_SOURCE_NOT_ACTIVE: '이미 환불 처리 중이거나 완료된 구매건입니다.',
    REFUND_CREDITS_ALREADY_USED: '이미 사용한 크레딧이 있어 환불할 수 없습니다.',
    REFUND_SOURCE_EXPIRED: '사용기한이 만료된 크레딧은 환불할 수 없습니다.',
    REFUND_REQUEST_PERIOD_EXPIRED: '구매 후 7일이 지나 환불을 요청할 수 없습니다.',
    REFUND_REQUEST_NOT_CLAIMABLE: '다른 관리자가 처리 중이거나 완료된 요청입니다.',
    REFUND_REQUEST_REVALIDATION_FAILED: '환불 조건이 변경되어 다시 확인해야 합니다.',
    REFUND_REQUEST_NOT_REJECTABLE: '현재 거절할 수 없는 환불 요청입니다.',
  }
  const code = Object.keys(knownMessages).find((key) => message.includes(key))
  return code ? knownMessages[code] : '환불 요청을 처리하지 못했습니다.'
}

const refundBlockReasons: Record<string, string> = {
  REFUND_SOURCE_NOT_FOUND: '구매건을 찾을 수 없습니다.',
  REFUND_PAID_SOURCE_REQUIRED: '토스페이먼츠 충전 건만 환불할 수 있습니다.',
  REFUND_COMPLETED_TOSS_PAYMENT_REQUIRED: '원 결제를 확인할 수 없습니다.',
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
    'get_toss_refund_eligibility',
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
  return callRefundRpc<RefundRequestResult>('request_toss_refund', {
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
  return callRefundRpc<ClaimedPointChargeRefund>('claim_toss_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_admin_note: input.adminNote,
  })
}

export function finalizePointChargeRefund(input: {
  requestId: string
  cancelTransactionKey: string
  cancelledAt: string
}) {
  return callRefundRpc<FinalizedPointChargeRefund>('finalize_toss_refund', {
    p_request_id: input.requestId,
    p_cancel_transaction_key: input.cancelTransactionKey,
    p_cancelled_at: input.cancelledAt,
  })
}

export async function failPointChargeRefund(input: {
  requestId: string
  code: string
  message: string
  retryable: boolean
}) {
  await callRefundRpc<null>('fail_toss_refund', {
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
}) {
  await callRefundRpc<null>('reject_toss_refund', {
    p_request_id: input.requestId,
    p_admin_id: input.adminId,
    p_admin_note: input.adminNote,
  })
}
