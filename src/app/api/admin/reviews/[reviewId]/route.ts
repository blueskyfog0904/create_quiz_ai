import { NextRequest, NextResponse } from 'next/server'
import { adminSoftDeleteMarketReview } from '@/lib/market-reviews-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

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
  return NextResponse.json({ success: true })
}
