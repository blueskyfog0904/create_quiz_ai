/**
 * /mypage/credits 페이지
 * 크레딧 잔액, 구매건 목록(FIFO), 거래 내역, 환불 요청
 */

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { CreditsClient } from './credits-client'

export const dynamic = 'force-dynamic'

export default async function CreditsPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  // 프로필 및 크레딧 잔액 조회
  const { data: profile } = await supabase
    .from('profiles')
    .select('credits')
    .eq('id', user.id)
    .single()

  // 구매건 목록 조회 (plan 정보 포함)
  const { data: sources } = await supabase
    .from('credit_sources')
    .select(`
      *,
      plan:pricing_plans(name, price)
    `)
    .eq('user_id', user.id)
    .order('purchased_at', { ascending: false })

  // 거래 내역 조회
  const { data: transactions } = await supabase
    .from('credit_transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // 환불 요청 조회
  const { data: refundRequests } = await supabase
    .from('refund_requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <CreditsClient
      balance={profile?.credits ?? 0}
      sources={sources || []}
      transactions={transactions || []}
      refundRequests={refundRequests || []}
    />
  )
}
