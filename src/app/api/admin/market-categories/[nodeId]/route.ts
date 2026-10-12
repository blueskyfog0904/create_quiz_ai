import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { deleteCategoryNode, MarketCategoryError, updateCategoryNode } from '@/lib/market-categories-server'
import { MARKET_CATEGORY_TREE_CACHE_TAG, MARKET_PUBLIC_LIST_CACHE_TAG } from '@/lib/market-images'
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
  title: z.string().trim().min(1).max(120).optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  // 칸 기본 이미지. null = 해제
  default_image_id: z.string().uuid().nullable().optional(),
})

// 칸이 바뀌면 공개 카테고리 트리와 그 칸 상품을 보여 주는 목록 캐시(홈·보드)를 바로 갱신한다.
function revalidateCategoryCaches() {
  revalidateTag(MARKET_CATEGORY_TREE_CACHE_TAG, { expire: 0 })
  revalidateTag(MARKET_PUBLIC_LIST_CACHE_TAG, { expire: 0 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const { nodeId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
    return NextResponse.json({ error: '잘못된 식별자입니다.' }, { status: 400 })
  }
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const node = await updateCategoryNode(nodeId, {
      title: parsed.data.title,
      sortOrder: parsed.data.sort_order,
      isActive: parsed.data.is_active,
      defaultImageId: parsed.data.default_image_id,
    })
    revalidateCategoryCaches()
    return NextResponse.json({ success: true, data: node })
  } catch (error) {
    return toErrorResponse(error, '칸을 수정하지 못했습니다.')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> }
) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const { nodeId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId)) {
    return NextResponse.json({ error: '잘못된 식별자입니다.' }, { status: 400 })
  }
  try {
    // 하위 칸에 상품이 있거나 하위 칸이 있으면 409(상품 연결은 풀지 않는다)
    await deleteCategoryNode(nodeId)
    revalidateCategoryCaches()
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error, '칸을 삭제하지 못했습니다.')
  }
}
