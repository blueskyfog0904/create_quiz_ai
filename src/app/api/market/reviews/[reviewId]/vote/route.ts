import { NextRequest, NextResponse } from 'next/server'
import { toggleMarketItemReviewVote } from '@/lib/market-reviews-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' },
    }, { status: 401 })
  }

  const { reviewId } = await params
  const result = await toggleMarketItemReviewVote(user.id, reviewId)
  if (!result.ok) {
    return NextResponse.json({
      success: false,
      error: { code: 'VOTE_FAILED', message: result.message },
    }, { status: result.status })
  }

  return NextResponse.json({ success: true, data: { voted: result.voted, count: result.count } })
}
