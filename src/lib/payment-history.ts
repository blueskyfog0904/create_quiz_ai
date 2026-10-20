type PaymentPlanRelation = {
  name: string
} | null

type PaymentPlanRelationInput = PaymentPlanRelation | PaymentPlanRelation[]

export interface PaymentHistoryRecord {
  id: string
  created_at: string
  amount: number
  status: string
  payment_method: string
  order_id?: string | null
  provider?: string | null
  provider_status?: string | null
  approved_at?: string | null
  plan_id: string | null
  pricing_plans: PaymentPlanRelationInput
  payment_method_label?: string | null
  refunded_amount?: number | null
}

export interface NormalizedPaymentHistoryRecord extends Omit<PaymentHistoryRecord, 'pricing_plans'> {
  pricing_plans: PaymentPlanRelation
}

export function normalizePaymentHistoryRecord(payment: PaymentHistoryRecord): NormalizedPaymentHistoryRecord {
  return {
    ...payment,
    pricing_plans: Array.isArray(payment.pricing_plans) ? payment.pricing_plans[0] ?? null : payment.pricing_plans,
  }
}

export function isRealPaidPlanPurchase(payment: PaymentHistoryRecord): boolean {
  return payment.plan_id !== null && payment.amount > 0
}

export function filterRealPaidPlanPurchases(payments: PaymentHistoryRecord[]): NormalizedPaymentHistoryRecord[] {
  return payments
    .filter(isRealPaidPlanPurchase)
    .map(normalizePaymentHistoryRecord)
}

// 결제수단 이름은 DB 라벨(payment_methods.label)을 쓴다. 라벨이 없는 과거 토스 건만 여기서 정한다.
export function getPaymentMethodLabel(payment: Pick<PaymentHistoryRecord, 'payment_method' | 'provider' | 'payment_method_label'>) {
  if (payment.payment_method_label) return payment.payment_method_label
  if (payment.provider === 'toss') return '일반결제(이전)'
  return payment.payment_method
}

// 결제사가 돌려준 상태값(토스·카카오페이 문자열, 페이앱 pay_state 숫자)을 사용자 문구로 바꾼다.
export function getProviderStatusLabel(providerStatus?: string | null) {
  switch (providerStatus) {
    case 'DONE':
    case 'SUCCESS_PAYMENT':
    case '4':
      return '승인 완료'
    case 'CANCELED':
    case 'CANCEL_PAYMENT':
    case '9':
    case '64':
      return '결제 취소 완료'
    case 'PART_CANCEL_PAYMENT':
    case 'PARTIAL_CANCELED':
    case '70':
    case '71':
      return '부분 취소'
    case '1':
      return '결제 요청'
    case '10':
      return '결제 대기'
    case '8':
    case '16':
    case '32':
      return '요청 취소'
    default:
      return providerStatus ?? '상태 확인 중'
  }
}

// 전액 환불이 아닌데 완료된 환불이 있으면 부분 환불액을 보여 준다.
export function getPartialRefundAmount(payment: Pick<PaymentHistoryRecord, 'status' | 'refunded_amount'>) {
  const refunded = payment.refunded_amount ?? 0
  return payment.status !== 'refunded' && refunded > 0 ? refunded : null
}
