import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import {
  getPublishedMarketItemById,
  incrementMarketItemViewCount,
  recordMarketItemView,
} from '@/lib/market-items-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ itemId: string }>
}

function hashIpAddress(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!forwarded) {
    return null
  }

  return createHash('sha256').update(forwarded).digest('hex')
}

function getSessionKey(request: NextRequest) {
  return request.headers.get('x-market-session-key')?.trim() || null
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { itemId } = await params
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  try {
    const item = await getPublishedMarketItemById(itemId, DEFAULT_WORKSPACE_SUBJECT)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    await recordMarketItemView({
      item_id: itemId,
      user_id: user.id,
      ip_hash: hashIpAddress(request),
      session_key: getSessionKey(request),
      workspace_subject: item.workspace_subject,
    })
    await incrementMarketItemViewCount(itemId, item.workspace_subject)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '조회 이벤트 기록에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
