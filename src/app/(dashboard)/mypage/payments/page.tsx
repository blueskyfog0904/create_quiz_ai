import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PaymentList } from './payment-list'
import { filterRealPaidPlanPurchases, type PaymentHistoryRecord } from '@/lib/payment-history'

export default async function PaymentsPage() {
  await requireAuth()
  const supabase = await createClient()

  // 로그인 사용자 확인
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // 결제 내역 조회
  const { data: payments } = await supabase
    .from('payment_history')
    .select(`
      id,
      created_at,
      amount,
      status,
      payment_method,
      order_id,
      provider,
      provider_status,
      approved_at,
      plan_id,
      pricing_plans (
        name
      )
    `)
    .eq('user_id', user.id)
    .gt('amount', 0)
    .not('plan_id', 'is', null)
    .order('created_at', { ascending: false })

  const formattedPayments = filterRealPaidPlanPurchases((payments ?? []) as PaymentHistoryRecord[])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            결제 내역
          </CardTitle>
          <CardDescription>
            요금제에서 실제로 결제한 구매 및 환불 기록을 확인하실 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentList payments={formattedPayments} />
        </CardContent>
      </Card>
    </div>
  )
}
