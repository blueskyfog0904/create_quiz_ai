import 'server-only'

import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { parseCheckoutConsentBundle, type CheckoutConsentLinkKey } from '@/lib/checkout-consent'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { buildMarketPurchaseInfo } from '@/lib/market-purchase-info'
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

// 11번 8절: 2판(접는 동의) 기록은 원문 대신 consent_details.consent 로 제목·요약 줄·항목 이름·본문을 그린다.
// link 항목은 지금 문서 링크로 그린다(결제 당시 판과 다를 수 있음). '링크:' 줄은 보이지 않는다.
export interface PaymentChargeConsentRecord {
  title: string
  summary: string[]
  items: Array<
    | { label: string; view: 'text'; texts: string[] }
    | { label: string; view: 'link'; href: string | null }
  >
}

export interface PaymentChargeDetail {
  // null 이면 결제 전 확인 기록 이전 결제(지금 설정 문구를 동의 문구로 보이지 않는다)
  noticeText: string | null
  // 2판 기록이면 값이 있다(그때는 noticeText 대신 이것을 그린다)
  consent: PaymentChargeConsentRecord | null
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
        .select('checkout_attempt_id, notice_text, consent_format, consent_details')
        .eq('user_id', userId)
        .in('checkout_attempt_id', screenAttemptIds)
      : { data: [], error: null }
    if (ackError) throw ackError
    const noticeByScreenAttemptId = new Map((acks ?? []).map((ack) => [ack.checkout_attempt_id, ack.notice_text]))
    const hasConsentRecord = (acks ?? []).some((ack) => ack.consent_format === 2)
    const links = hasConsentRecord ? buildMarketPurchaseInfo(await getSiteFooterContent()) : null
    const hrefOf = (link: CheckoutConsentLinkKey) => (link === 'refundPolicy' ? links?.refundPolicyLink?.href : links?.termsLink?.href) ?? null
    const consentByScreenAttemptId = new Map((acks ?? []).flatMap((ack): Array<[string, PaymentChargeConsentRecord]> => {
      if (ack.consent_format !== 2) return []
      const details = ack.consent_details && typeof ack.consent_details === 'object' && !Array.isArray(ack.consent_details)
        ? (ack.consent_details as Record<string, unknown>).consent : null
      // 기록 칸에는 지문(noticeSha256)을 빼고 남기므로 모양 검사만을 위해 자리 값을 붙여 해석한다.
      const bundle = details && typeof details === 'object' && !Array.isArray(details)
        ? parseCheckoutConsentBundle({ ...(details as Record<string, unknown>), noticeSha256: '0'.repeat(64) }) : null
      if (!bundle) return []
      return [[ack.checkout_attempt_id, {
        title: bundle.consentTitle,
        summary: bundle.consentSummary,
        items: bundle.consentItems.map((item) => (item.view === 'text'
          ? { label: item.label, view: 'text' as const, texts: item.texts }
          : { label: item.label, view: 'link' as const, href: hrefOf(item.link) })),
      }]]
    }))

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
        consent: screenAttemptId ? consentByScreenAttemptId.get(screenAttemptId) ?? null : null,
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
