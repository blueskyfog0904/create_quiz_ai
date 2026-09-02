import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteCategoryGroup, MarketCategoryError, updateCategoryGroup } from '@/lib/market-categories-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }
  return { user }
}

function toErrorResponse(error: unknown, fallback: string) {
  if (error instanceof MarketCategoryError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 }
  )
}

const PatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const { groupId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) {
    return NextResponse.json({ error: '잘못된 식별자입니다.' }, { status: 400 })
  }
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const group = await updateCategoryGroup(groupId, {
      title: parsed.data.title,
      sortOrder: parsed.data.sort_order,
      isActive: parsed.data.is_active,
    })
    return NextResponse.json({ success: true, data: group })
  } catch (error) {
    return toErrorResponse(error, '카테고리 그룹을 수정하지 못했습니다.')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const { groupId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) {
    return NextResponse.json({ error: '잘못된 식별자입니다.' }, { status: 400 })
  }
  try {
    // 하위 항목은 cascade 삭제, 연결 상품의 category_item_id는 SET NULL로 해제됨
    await deleteCategoryGroup(groupId)
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error, '카테고리 그룹을 삭제하지 못했습니다.')
  }
}
