import 'server-only'

import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import {
  getPointChargeRefundEligibility,
  reportPointChargePolicyFallback,
} from '@/lib/point-charge-refunds-server'

// 결제 내역 상세(계약내용 교부, 전자상거래법 13조2항): 이 결제에 동의한 결제 전 확인 문구와 환불 마감.
// 본인 것만 서버 키로 읽는다. 동의 행은 payment_orders.checkout_attempt_id(내부 PK) → checkout_attempts.id
// → (user_id, checkout_attempts.checkout_attempt_id) → point_charge_checkout_acks 로 찾는다.
// 마감은 코드에서 계산하지 않고 그 주문 원천의 판정 함수(get_point_charge_refund_eligibility) refundable_until 을 그대로 쓴다.
export type PaymentRefundDeadline =
  | { status: 'ok'; refundableUntil: string }
  | { status: 'policy' } // 원천이 아직 없거나 마감이 없음 → 취소·환불정책 링크
  | { status: 'unknown' } // 판정 조회 실패 → '확인할 수 없음'

export interface PaymentChargeDetail {
  // null 이면 결제 전 확인 기록 이전 결제(지금 설정 문구를 동의 문구로 보이지 않는다)
  noticeText: string | null
  refundDeadline: PaymentRefundDeadline
  approvedAt: string | null
  // 크레딧 지급 일시(화면은 결제 일시와 분 단위로 다를 때만 보여 준다)
  creditedAt: string | null
}

// payment_history.id → 상세. 전체 조회가 실패하면 빈 객체(목록은 그대로, 상세 칸만 빠진다).
export async function loadPaymentChargeDetails(
  userId: string,
  paymentHistoryIds: string[]
): Promise<Record<string, PaymentChargeDetail>> {
  if (paymentHistoryIds.length === 0) return {}
  try {
    const admin = createPaymentAdminClient()
    const { data: histories, error: historyError } = await admin.from('payment_history')
      .select('id, payment_order_id, source_id, approved_at')
      .eq('user_id', userId)
      .in('id', paymentHistoryIds)
    if (historyError) throw historyError

    const orderIds = [...new Set((histories ?? []).map((row) => row.payment_order_id).filter((id): id is string => !!id))]
    const { data: orders, error: orderError } = orderIds.length > 0
      ? await admin.from('payment_orders')
        .select('id, checkout_attempt_id, source_id, approved_at')
        .eq('user_id', userId)
        .in('id', orderIds)
      : { data: [], error: null }
    if (orderError) throw orderError
    const orderById = new Map((orders ?? []).map((order) => [order.id, order]))

    const attemptPks = [...new Set((orders ?? []).map((order) => order.checkout_attempt_id).filter((id): id is string => !!id))]
    const { data: attempts, error: attemptError } = attemptPks.length > 0
      ? await admin.from('checkout_attempts')
        .select('id, checkout_attempt_id')
        .eq('user_id', userId)
        .in('id', attemptPks)
      : { data: [], error: null }
    if (attemptError) throw attemptError
    const screenAttemptIdByPk = new Map((attempts ?? []).map((attempt) => [attempt.id, attempt.checkout_attempt_id]))

    const screenAttemptIds = [...new Set(screenAttemptIdByPk.values())]
    const { data: acks, error: ackError } = screenAttemptIds.length > 0
      ? await admin.from('point_charge_checkout_acks')
        .select('checkout_attempt_id, notice_text')
        .eq('user_id', userId)
        .in('checkout_attempt_id', screenAttemptIds)
      : { data: [], error: null }
    if (ackError) throw ackError
    const noticeByScreenAttemptId = new Map((acks ?? []).map((ack) => [ack.checkout_attempt_id, ack.notice_text]))

    const sourceIds = [...new Set((histories ?? [])
      .map((row) => orderById.get(row.payment_order_id ?? '')?.source_id ?? row.source_id)
      .filter((id): id is string => !!id))]
    const { data: sources, error: sourceError } = sourceIds.length > 0
      ? await admin.from('credit_sources')
        .select('id, created_at')
        .eq('user_id', userId)
        .in('id', sourceIds)
      : { data: [], error: null }
    if (sourceError) throw sourceError
    const creditedAtBySourceId = new Map((sources ?? []).map((source) => [source.id, source.created_at]))

    const entries = await Promise.all((histories ?? []).map(async (row): Promise<[string, PaymentChargeDetail]> => {
      const order = row.payment_order_id ? orderById.get(row.payment_order_id) : undefined
      const sourceId = order?.source_id ?? row.source_id
      const screenAttemptId = order?.checkout_attempt_id ? screenAttemptIdByPk.get(order.checkout_attempt_id) : undefined
      const approvedAt = order?.approved_at ?? row.approved_at
      const creditedAt = sourceId ? creditedAtBySourceId.get(sourceId) ?? null : null

      let refundDeadline: PaymentRefundDeadline = { status: 'policy' }
      if (sourceId) {
        try {
          const eligibility = await getPointChargeRefundEligibility({ userId, sourceId })
          if (eligibility.policyFallback) {
            await reportPointChargePolicyFallback({
              userId,
              sourceId,
              paymentOrderId: order?.id ?? row.payment_order_id,
              screen: 'mypage_payments',
            })
          }
          refundDeadline = eligibility.refundableUntil
            ? { status: 'ok', refundableUntil: eligibility.refundableUntil }
            : { status: 'policy' }
        } catch (error) {
          console.error('[mypage payments] 환불 판정 조회 실패', { paymentHistoryId: row.id, error })
          refundDeadline = { status: 'unknown' }
        }
      }

      return [row.id, {
        noticeText: screenAttemptId ? noticeByScreenAttemptId.get(screenAttemptId) ?? null : null,
        refundDeadline,
        approvedAt,
        creditedAt,
      }]
    }))
    return Object.fromEntries(entries)
  } catch (error) {
    console.error('[mypage payments] 결제 상세 조회 실패', error)
    return {}
  }
}
