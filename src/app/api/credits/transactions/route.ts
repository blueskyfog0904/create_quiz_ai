/**
 * GET /api/credits/transactions
 * 사용자의 크레딧 거래 내역을 조회합니다.
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const limit = parseInt(searchParams.get('limit') || '50', 10)

        const { data: transactions, error } = await supabase
            .from('credit_transactions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(limit)

        if (error) {
            console.error('Failed to fetch transactions:', error)
            return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 })
        }

        return NextResponse.json({ transactions: transactions || [] })
    } catch (error) {
        console.error('Failed to fetch transactions:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
