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
