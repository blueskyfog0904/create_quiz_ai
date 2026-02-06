/**
 * POST /api/refunds/request
 * 환불 요청을 생성합니다.
 * 
 * Body: { sourceId: string, reason?: string }
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { CreditService } from '@/lib/credits'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { sourceId, reason } = body

        if (!sourceId) {
            return NextResponse.json({ error: 'sourceId is required' }, { status: 400 })
        }

        // 환불 요청 처리
        const result = await CreditService.requestRefund(user.id, sourceId, reason)

        return NextResponse.json({
            success: true,
            requestId: result.requestId,
            message: '환불 요청이 접수되었습니다. 관리자 승인 후 처리됩니다.'
        })
    } catch (error) {
        console.error('Failed to request refund:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
