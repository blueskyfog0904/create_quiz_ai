import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateMarketReviewTag } from '@/lib/market-reviews-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

const PatchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const guard = await requireAdminApiPermission('reviews.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { tagId } = await params
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  const result = await updateMarketReviewTag({
    tagId,
    label: parsed.data.label,
    sortOrder: parsed.data.sort_order,
    isActive: parsed.data.is_active,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
