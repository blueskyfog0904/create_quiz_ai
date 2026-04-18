/**
 * POST /api/credits/deduct
 * 크레딧을 FIFO 방식으로 차감합니다.
 * 
 * Body: { amount: number, resourceType: string, resourceId?: string, description?: string }
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
        const { amount, resourceType, resourceId, description } = body

        if (!amount || amount <= 0) {
            return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
        }

        if (!resourceType) {
            return NextResponse.json({ error: 'resourceType is required' }, { status: 400 })
        }

        // FIFO 차감
        const result = await CreditService.deductCredits(
            user.id,
            amount,
            resourceType,
            resourceId || null,
            description || `${resourceType} 사용`
        )

        const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

        return NextResponse.json({
            success: true,
            newBalance: result.newBalance,
            consumptions: result.consumptions,
            ...buildCreditBalanceResponseFields(snapshot),
        })
    } catch (error) {
        console.error('Failed to deduct credits:', error)

        // 크레딧 부족 에러 처리
        if (error instanceof Error && error.message.includes('크레딧이 부족')) {
            return NextResponse.json(
                { error: '크레딧이 부족합니다. 충전 후 다시 시도해주세요.' },
                { status: 402 } // Payment Required
            )
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
