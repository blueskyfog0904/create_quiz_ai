import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { createCategoryNode, listMarketCategoryTreeForAdmin, MarketCategoryError } from '@/lib/market-categories-server'
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

export async function GET(request: NextRequest) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  try {
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const nodes = await listMarketCategoryTreeForAdmin(workspaceSubject)
    return NextResponse.json({ success: true, data: { nodes } })
  } catch (error) {
    if (error instanceof MarketCategoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '카테고리 목록을 불러오지 못했습니다.' },
      { status: 500 }
    )
  }
}

const PostSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']),
  // null이면 depth1 칸
  parent_id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(120),
  sort_order: z.number().int().optional(),
})

export async function POST(request: NextRequest) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const body = await request.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const node = await createCategoryNode({
      workspaceSubject: parsed.data.workspace_subject,
      parentId: parsed.data.parent_id,
      title: parsed.data.title,
      sortOrder: parsed.data.sort_order,
    })
    // 공개 카테고리 트리와 그 칸 상품을 보여 주는 목록 캐시를 바로 갱신한다.
    revalidateTag(MARKET_CATEGORY_TREE_CACHE_TAG, { expire: 0 })
    revalidateTag(MARKET_PUBLIC_LIST_CACHE_TAG, { expire: 0 })
    return NextResponse.json({ success: true, data: node }, { status: 201 })
  } catch (error) {
    if (error instanceof MarketCategoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '칸을 만들지 못했습니다.' },
      { status: 500 }
    )
  }
}
