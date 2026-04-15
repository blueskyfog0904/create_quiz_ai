import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PaymentList } from './payment-list'
import { isRealPaidPlanPurchase } from './payment-history'

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
      plan_id,
      payment_key,
      status,
      payment_method,
      plan_id,
      pricing_plans (
        name
      )
    `)
    .eq('user_id', user.id)
    .not('plan_id', 'is', null)
    .not('payment_key', 'is', null)
    .gt('amount', 0)
    .order('created_at', { ascending: false })

  const formattedPayments = payments
    ?.filter(isRealPaidPlanPurchase)
    .map((payment: any) => ({
      ...payment,
      pricing_plans: Array.isArray(payment.pricing_plans) ? payment.pricing_plans[0] : payment.pricing_plans
    }))

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
          <PaymentList payments={formattedPayments || []} />
        </CardContent>
      </Card>
    </div>
  )
}

