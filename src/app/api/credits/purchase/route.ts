/**
 * POST /api/credits/purchase
 * 크레딧을 구매합니다. (현재는 테스트용, 나중에 토스페이먼츠 연동 예정)
 * 
 * Body: { planId: string }
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { CreditService } from '@/lib/credits'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { planId } = body

        if (!planId) {
            return NextResponse.json({ error: 'planId is required' }, { status: 400 })
        }

        // 요금제 정보 조회
        const { data: plan, error: planError } = await supabase
            .from('pricing_plans')
            .select('*')
            .eq('id', planId)
            .eq('is_active', true)
            .single()

        if (planError || !plan) {
            return NextResponse.json({ error: '요금제를 찾을 수 없습니다.' }, { status: 404 })
        }

        // 크레딧 구매 처리 (테스트 모드)
        const result = await CreditService.purchaseCredits(
            user.id,
            planId,
            plan.credits,
            plan.price,
            'test', // 테스트 결제
            undefined,
            'plan_purchase'
        )

        const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

        return NextResponse.json({
            success: true,
            sourceId: result.sourceId,
            newBalance: result.newBalance,
            ...buildCreditBalanceResponseFields(snapshot),
            message: `${plan.name} 요금제 구매 완료! ${plan.credits.toLocaleString()} 크레딧이 충전되었습니다.`
        })
    } catch (error) {
        console.error('Failed to purchase credits:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
