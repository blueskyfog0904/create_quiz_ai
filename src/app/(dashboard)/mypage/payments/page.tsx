import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CreditCard } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { PaymentList } from './payment-list'

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
      pricing_plans (
        name
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            결제 내역
          </CardTitle>
          <CardDescription>
            크레딧 구매 및 결제 기록을 확인하실 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentList payments={payments || []} />
        </CardContent>
      </Card>
    </div>
  )
}


