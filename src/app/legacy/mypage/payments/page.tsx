import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PaymentList } from './payment-list'
import { filterRealPaidPlanPurchases, type PaymentHistoryRecord } from '@/lib/payment-history'
import type { Database } from '@/types/supabase'

type SafePaymentHistory =
  Database['public']['Functions']['get_my_payment_history']['Returns'][number]

export default async function PaymentsPage() {
  await requireAuth()
  const supabase = await createClient()

  const { data: payments } = await supabase
    .rpc('get_my_payment_history')

  const paymentRecords = (payments ?? []).map(
    ({ plan_name, ...payment }: SafePaymentHistory) => ({
      ...payment,
      pricing_plans: plan_name ? { name: plan_name } : null,
    })
  ) as PaymentHistoryRecord[]
  const formattedPayments = filterRealPaidPlanPurchases(paymentRecords)

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
