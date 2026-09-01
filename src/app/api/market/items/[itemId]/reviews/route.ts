import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMarketItemById } from '@/lib/market-items-server'
import { upsertMarketItemReview } from '@/lib/market-reviews-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().max(1000).optional().nullable(),
  tagIds: z.array(z.string().uuid()).max(8).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' },
    }, { status: 401 })
  }

  const { itemId } = await params
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '후기 내용이 올바르지 않습니다.' },
    }, { status: 400 })
  }

  // 과목은 클라이언트 입력이 아니라 아이템에서 확정
  const item = await getMarketItemById(itemId)
  if (!item) {
    return NextResponse.json({
      success: false,
      error: { code: 'NOT_FOUND', message: '자료를 찾을 수 없습니다.' },
    }, { status: 404 })
  }

  const result = await upsertMarketItemReview({
    userId: user.id,
    itemId,
    workspaceSubject: item.workspace_subject,
    rating: parsed.data.rating,
    content: parsed.data.content,
    tagIds: parsed.data.tagIds,
  })

  if (!result.ok) {
    return NextResponse.json({
      success: false,
      error: { code: 'REVIEW_FAILED', message: result.message },
    }, { status: result.status })
  }

  return NextResponse.json({ success: true })
}
