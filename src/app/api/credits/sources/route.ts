/**
 * GET /api/credits/sources
 * 사용자의 크레딧 소스(구매건) 목록을 조회합니다.
 * 환불 가능 여부 정보도 함께 반환합니다.
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { CreditService } from '@/lib/credits'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 모든 구매건 조회 (plan 정보 포함)
        const { data: sources, error } = await supabase
            .from('credit_sources')
            .select(`
        *,
        plan:pricing_plans(name, price)
      `)
            .eq('user_id', user.id)
            .order('purchased_at', { ascending: false })

        if (error) {
            console.error('Failed to fetch credit sources:', error)
            return NextResponse.json({ error: 'Failed to fetch sources' }, { status: 500 })
        }

        // 각 소스에 환불 가능 여부 추가
        const sourcesWithRefundInfo = (sources || []).map(source => {
            const eligibility = CreditService.canRequestRefund(source as any)
            return {
                ...source,
                canRefund: eligibility.allowed,
                refundBlockedReason: eligibility.reason
            }
        })

        return NextResponse.json({ sources: sourcesWithRefundInfo })
    } catch (error) {
        console.error('Failed to fetch credit sources:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
