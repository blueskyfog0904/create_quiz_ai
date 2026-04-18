/**
 * /mypage/credits 페이지
 * 크레딧 잔액, 구매건 목록(FIFO), 거래 내역, 환불 요청
 */

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getCreditBalanceSnapshot, logCreditBalanceMismatch, selectDisplayBalance } from '@/lib/credit-balance'
import { CreditsClient } from './credits-client'

export const dynamic = 'force-dynamic'

export default async function CreditsPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

  if (snapshot.hasMismatch) {
    logCreditBalanceMismatch('mypage credits', user.id, snapshot)
  }

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
    .select(`
      *,
      source:credit_sources(
        source_category
      )
    `)
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
      balance={selectDisplayBalance(user.id, snapshot)}
      sources={sources || []}
      transactions={transactions || []}
      refundRequests={refundRequests || []}
    />
  )
}
