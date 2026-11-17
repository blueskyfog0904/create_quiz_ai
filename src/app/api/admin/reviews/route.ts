import { NextRequest, NextResponse } from 'next/server'
import { listMarketReviewsForAdmin } from '@/lib/market-reviews-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import { normalizeListPage, normalizeListPageSize } from '@/lib/list-pagination'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const guard = await requireAdminApiPermission('reviews.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
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
