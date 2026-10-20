import type { PaymentOrderStatus } from '@/lib/payment-orders-server'

// 결제창을 다시 줄 때 남은 시간이 이보다 짧으면 만료로 본다. 결제 중에 대사가 요청을 취소하지 않게 한다.
export const PAYAPP_READY_REUSE_MIN_REMAINING_MS = 2 * 60_000

export type ExistingPayAppOrderAction = 'reuse_payurl' | 'show_result' | 'unknown' | 'expired'

// 같은 결제 시도로 다시 요청했을 때의 처리(계획 6.2). payrequest는 다시 보내지 않는다.
export function classifyExistingPayAppOrder(
  status: PaymentOrderStatus,
  readyExpiresAt: string | null,
  now: number
): ExistingPayAppOrderAction {
  if (status === 'ready') {
    const remaining = readyExpiresAt ? new Date(readyExpiresAt).getTime() - now : 0
    return remaining > PAYAPP_READY_REUSE_MIN_REMAINING_MS ? 'reuse_payurl' : 'expired'
  }
  if (status === 'ready_unknown' || status === 'preparing') return 'unknown'
  if (status === 'failed' || status === 'expired') return 'expired'
  // 지급 완료·지급 대기·수동 확인·환불 건은 결제됐을 수 있으므로 다시 결제하게 하지 않는다.
  return 'show_result'
}

export type PublicPayAppStatus = 'completed' | 'pending' | 'failed' | 'expired' | 'refunded'

// fulfillment_pending·manual_review도 "결제 확인 중"으로 보인다.
export function publicPayAppStatus(status: string): PublicPayAppStatus {
  if (status === 'completed') return 'completed'
  if (status === 'refunded') return 'refunded'
  if (status === 'failed' || status === 'expired') return status
  return 'pending'
}

// 프로필 휴대폰 번호는 하이픈 형식으로 저장한다(마이페이지 검증 규칙과 같음).
export function formatProfilePhone(digits: string) {
  return digits.length === 11
    ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    : `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}
