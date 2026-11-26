import { NextRequest, NextResponse } from 'next/server'
import { listMarketReviewsForAdmin } from '@/lib/market-reviews-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
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

  const page = normalizeListPage(searchParams.get('page'))
  const result = await listMarketReviewsForAdmin({
    workspaceSubject: isWorkspaceSubject(subjectParam) ? subjectParam : undefined,
    rating: Number.isInteger(ratingParam) && ratingParam >= 1 && ratingParam <= 5 ? ratingParam : undefined,
    search: searchParams.get('search') ?? undefined,
    page,
    pageSize: normalizeListPageSize(searchParams.get('pageSize')),
    // 13번 8절: 작성자 이메일을 싣기 전에 열람 기록을 남긴다(남기지 못하면 이메일을 빼고 보냄).
    recordAuthorAccess: (userIds) => recordMemberAccess({
      access: guard.access,
      screen: 'reviews.list',
      memberIds: userIds,
      fields: ['email'],
      context: { searched: Boolean(searchParams.get('search')?.trim()), page },
      requestMeta: adminRequestMeta(request),
    }),
  })

  return NextResponse.json({ success: true, data: result })
}
