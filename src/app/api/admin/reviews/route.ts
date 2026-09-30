import { NextRequest, NextResponse } from 'next/server'
import { listMarketReviewsForAdmin } from '@/lib/market-reviews-server'
import { createClient } from '@/lib/supabase/server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import { normalizeListPage, normalizeListPageSize } from '@/lib/list-pagination'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const searchParams = new URL(request.url).searchParams
  const subjectParam = searchParams.get('subject')
  const ratingParam = Number(searchParams.get('rating') ?? '')

  const result = await listMarketReviewsForAdmin({
    workspaceSubject: isWorkspaceSubject(subjectParam) ? subjectParam : undefined,
    rating: Number.isInteger(ratingParam) && ratingParam >= 1 && ratingParam <= 5 ? ratingParam : undefined,
    search: searchParams.get('search') ?? undefined,
    page: normalizeListPage(searchParams.get('page')),
    pageSize: normalizeListPageSize(searchParams.get('pageSize')),
  })

  return NextResponse.json({ success: true, data: result })
}
