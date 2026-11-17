import { NextRequest, NextResponse } from 'next/server'
import { adminSoftDeleteMarketReview } from '@/lib/market-reviews-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const guard = await requireAdminApiPermission('reviews.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { reviewId } = await params
  const result = await adminSoftDeleteMarketReview(reviewId)
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }
  await recordAdminAudit({
    actorId: guard.access.userId,
    action: 'market_review_delete',
    targetType: 'market_item_review',
    targetId: reviewId,
    targetUserId: result.userId,
    details: { market_item_id: result.itemId },
  })
  return NextResponse.json({ success: true })
}
