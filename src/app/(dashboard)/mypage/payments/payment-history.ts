export interface PaymentHistoryDisplayCandidate {
  amount: number | null
  plan_id: string | null
  payment_key: string | null
}

export function isRealPaidPlanPurchase({
  amount,
  plan_id,
  payment_key,
}: PaymentHistoryDisplayCandidate): boolean {
  return Boolean(plan_id) && Boolean(payment_key) && typeof amount === 'number' && amount > 0
}
