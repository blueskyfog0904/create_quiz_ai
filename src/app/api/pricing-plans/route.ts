/**
 * GET /api/pricing-plans
 * 활성화된 요금제 목록을 조회합니다.
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const supabase = await createClient()

        const { data: plans, error } = await supabase
            .from('pricing_plans')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })

        if (error) {
            console.error('Failed to fetch pricing plans:', error)
            return NextResponse.json({ error: 'Failed to fetch plans' }, { status: 500 })
        }

        return NextResponse.json({ plans: plans || [] })
    } catch (error) {
        console.error('Failed to fetch pricing plans:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
