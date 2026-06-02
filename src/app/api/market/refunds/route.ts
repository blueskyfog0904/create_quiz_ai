import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requestMarketRefund } from '@/lib/market-refunds'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  targetKind: z.enum(['legacy_purchase', 'v2_order']),
  targetId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' },
    }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '환불 요청이 올바르지 않습니다.' },
    }, { status: 400 })
  }

  try {
    const refundRequest = await requestMarketRefund({
      userId: user.id,
      targetKind: parsed.data.targetKind,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason ?? null,
    })

    return NextResponse.json({
      success: true,
      data: refundRequest,
      message: '환불 신청이 접수되었습니다.',
    })
  } catch (error) {
    const isDownloadBlocked = error instanceof Error && (error.name === 'DOWNLOAD_EXISTS' || error.message.includes('다운로드'))
    return NextResponse.json({
      success: false,
      error: {
        code: isDownloadBlocked ? 'ALREADY_DOWNLOADED' : 'REFUND_NOT_ALLOWED',
        message: error instanceof Error ? error.message : '환불 신청 처리에 실패했습니다.',
      },
    }, { status: isDownloadBlocked ? 409 : 400 })
  }
}
