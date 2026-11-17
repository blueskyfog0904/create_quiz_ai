import type { createAdminClient } from '@/lib/supabase/bypass'

// 결제 이력(payment_orders/checkout_attempts)은 재무 감사를 위해 profiles를
// ON DELETE RESTRICT로 참조하므로, 이 경우 계정 삭제가 불가능하다.
// 탈퇴 route와 탈퇴 화면이 같은 조건을 쓰도록 한 곳에 둔다. RLS를 우회해 세야 하므로 service role 클라이언트를 받는다.
export async function hasPaymentRecordsBlockingWithdrawal(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const [{ count: paymentOrderCount }, { count: checkoutAttemptCount }] = await Promise.all([
    admin.from('payment_orders').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin.from('checkout_attempts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  return (paymentOrderCount ?? 0) > 0 || (checkoutAttemptCount ?? 0) > 0
}
