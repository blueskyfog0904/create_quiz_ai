/**
 * GET /api/admin/refunds - 환불 요청 목록 조회 (관리자 전용)
 * PATCH /api/admin/refunds - 환불 승인/거부 (관리자 전용)
 */

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { CreditService } from '@/lib/credits'

export const dynamic = 'force-dynamic'

// 관리자 권한 확인 헬퍼
async function requireAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { error: 'Unauthorized', status: 401 }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        return { error: 'Forbidden: Admin only', status: 403 }
    }

    return { user, profile }
}

/**
 * GET: 환불 요청 목록 조회
 */
export async function GET(request: NextRequest) {
    try {
        const adminCheck = await requireAdmin()
        if ('error' in adminCheck) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status })
        }

        const supabase = await createClient()
        const { searchParams } = new URL(request.url)
        const status = searchParams.get('status') || 'pending'

        const { data: requests, error } = await supabase
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
            .eq('status', status)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Failed to fetch refund requests:', error)
            return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 })
        }

        // 통계 조회
        const { data: stats } = await supabase
            .from('refund_requests')
            .select('status')

        const pendingCount = stats?.filter(s => s.status === 'pending').length || 0
        const approvedCount = stats?.filter(s => s.status === 'approved').length || 0
        const rejectedCount = stats?.filter(s => s.status === 'rejected').length || 0

        return NextResponse.json({
            requests: requests || [],
            stats: { pendingCount, approvedCount, rejectedCount }
        })
    } catch (error) {
        console.error('Failed to fetch refund requests:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * PATCH: 환불 승인/거부
 * Body: { requestId: string, action: 'approve' | 'reject', adminNote?: string }
 */
export async function PATCH(request: NextRequest) {
    try {
        const adminCheck = await requireAdmin()
        if ('error' in adminCheck) {
            return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status })
        }

        const body = await request.json()
        const { requestId, action, adminNote } = body

        if (!requestId) {
            return NextResponse.json({ error: 'requestId is required' }, { status: 400 })
        }

        if (!['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 })
        }

        if (action === 'approve') {
            await CreditService.approveRefund(requestId, adminCheck.user.id, adminNote)
            return NextResponse.json({
                success: true,
                message: '환불이 승인되었습니다.'
            })
        } else {
            await CreditService.rejectRefund(requestId, adminCheck.user.id, adminNote)
            return NextResponse.json({
                success: true,
                message: '환불이 거부되었습니다.'
            })
        }
    } catch (error) {
        console.error('Failed to process refund:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
