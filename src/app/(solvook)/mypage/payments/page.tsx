import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { createClient } from '@/lib/supabase/server'
import { filterRealPaidPlanPurchases, type PaymentHistoryRecord } from '@/lib/payment-history'
import type { Database } from '@/types/supabase'
import { PaymentsView } from './_components/payments-view'

export const metadata: Metadata = {
  title: '결제 내역 | 써머썬 연구소',
  description: '요금제 결제 및 환불 기록을 확인합니다.',
}

type SafePaymentHistory =
  Database['public']['Functions']['get_my_payment_history']['Returns'][number]

export default async function MypagePaymentsPage() {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/payments')}`)
  }

  const supabase = await createClient()
  const { data: payments } = await supabase.rpc('get_my_payment_history')

  const paymentRecords = (payments ?? []).map(
    ({ plan_name, ...payment }: SafePaymentHistory) => ({
      ...payment,
      pricing_plans: plan_name ? { name: plan_name } : null,
    })
  ) as PaymentHistoryRecord[]
  const formattedPayments = filterRealPaidPlanPurchases(paymentRecords)

  return (
    <Suspense fallback={null}>
      <PaymentsView payments={formattedPayments} />
    </Suspense>
  )
}
