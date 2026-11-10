// 관리자 결제 확인·수동 환불 화면이 DB 함수의 가드와 같은 기준으로 가능한 처리만 보여 주게 한다.
// 최종 판단은 DB 함수(resolve_payment_order_review, complete_manual_point_charge_refund)가 한다.

export type ReviewAction = 'paid_confirmed' | 'unpaid_confirmed' | 'cancel_handled'

export interface ReviewOrderFacts {
  provider: string
  failureCode: string | null
  hasTransaction: boolean
  hasSource: boolean
  sourceRefunded: boolean
  paidRecorded: boolean
  adminPaidConfirmed: boolean
  cancelMarker: boolean
  partialCancelMarker: boolean
}

// 격리·취소 처리 실패 건은 결제 확인으로 지급할 수 없다.
const PAID_CONFIRM_BLOCKING_CODES = [
  'EXTERNAL_PROVIDER_CANCELLATION',
  'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
  'PAYAPP_CANCEL_HANDLING_FAILED',
]

export function allowedReviewActions(order: ReviewOrderFacts): ReviewAction[] {
  const actions: ReviewAction[] = []
  const noCancel = !order.cancelMarker && !order.partialCancelMarker

  if (
    order.provider === 'payapp' &&
    order.hasTransaction &&
    !order.hasSource &&
    noCancel &&
    !PAID_CONFIRM_BLOCKING_CODES.includes(order.failureCode ?? '')
  ) {
    actions.push('paid_confirmed')
  }

  if (
    order.provider === 'payapp' &&
    !order.hasSource &&
    !order.paidRecorded &&
    !order.adminPaidConfirmed &&
    noCancel
  ) {
    actions.push('unpaid_confirmed')
  }

  const cancelHandledCode =
    (order.provider === 'payapp' &&
      ['PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED'].includes(order.failureCode ?? '')) ||
    (order.provider === 'kakaopay' &&
      order.failureCode === 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW')
  if (cancelHandledCode && (!order.hasSource || order.sourceRefunded)) {
    actions.push('cancel_handled')
  }

  return actions
}

// 부분취소 건은 실제 환불액과 회수할 크레딧을 관리자가 정해야 한다.
// 승인취소(전액) 표식이 있으면 DB가 전량 회수를 강제하므로 회수량을 받지 않는다.
export function refundRequiresRecovery(input: {
  origin: string
  cancelMarker: boolean
  partialCancelMarker: boolean
  lastErrorCode: string | null
}) {
  if (input.cancelMarker) return false
  return input.origin === 'partial_cancel' ||
    input.partialCancelMarker ||
    input.lastErrorCode === 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW'
}
