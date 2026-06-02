import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { approveMarketRefund, rejectMarketRefund } from '@/lib/market-refunds'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  adminNote: z.string().trim().max(1000).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized', status: 401 } as const
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: 'Forbidden: Admin only', status: 403 } as const
  }

  return { user } as const
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ success: false, error: adminCheck.error }, { status: adminCheck.status })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: parsed.error.issues[0]?.message || '처리 요청이 올바르지 않습니다.',
    }, { status: 400 })
  }

  try {
    const data = parsed.data.action === 'approve'
      ? await approveMarketRefund({ requestId: id, adminId: adminCheck.user.id, adminNote: parsed.data.adminNote ?? null })
      : await rejectMarketRefund({ requestId: id, adminId: adminCheck.user.id, adminNote: parsed.data.adminNote ?? null })

    return NextResponse.json({
      success: true,
      data,
      message: parsed.data.action === 'approve' ? '문제마켓 환불이 승인되었습니다.' : '문제마켓 환불이 거부되었습니다.',
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '문제마켓 환불 처리에 실패했습니다.',
    }, { status: 500 })
  }
}
