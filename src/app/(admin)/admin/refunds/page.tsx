/**
 * /admin/refunds 페이지
 * 관리자용 환불 요청 관리 페이지
 */

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RefundsClient } from './refunds-client'
import { MarketRefundsClient } from './market-refunds-client'

export const dynamic = 'force-dynamic'

export default async function AdminRefundsPage() {
    const user = await requireAuth()
    const supabase = await createClient()

    // 관리자 권한 확인
    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        redirect('/')
    }

    // 환불 요청 목록 조회
    const { data: requests } = await supabase
        .from('refund_requests')
        .select(`
      *,
      user:profiles!refund_requests_user_id_fkey(id, name, email),
      source:credit_sources(
        id, 
        initial_credits, 
        remaining_credits, 
        purchased_at,
        plan:pricing_plans(name, price)
      ),
      processor:profiles!refund_requests_processed_by_fkey(id, name)
    `)
        .order('created_at', { ascending: false })

    // 통계 조회
    const pendingCount = requests?.filter(r => r.status === 'pending').length || 0
    const approvedCount = requests?.filter(r => r.status === 'approved').length || 0
    const rejectedCount = requests?.filter(r => r.status === 'rejected').length || 0

    const { data: marketRefundRequests } = await supabase
        .from('market_refund_requests')
        .select('*')
        .order('created_at', { ascending: false })

    return (
        <div className="space-y-8">
            <RefundsClient
                requests={requests || []}
                stats={{ pendingCount, approvedCount, rejectedCount }}
            />
            <h2 className="sr-only">문제마켓 환불</h2>
            <MarketRefundsClient requests={marketRefundRequests || []} />
        </div>
    )
}
