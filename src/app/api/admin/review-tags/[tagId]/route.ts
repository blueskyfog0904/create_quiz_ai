import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateMarketReviewTag } from '@/lib/market-reviews-server'
import { createClient } from '@/lib/supabase/server'

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
