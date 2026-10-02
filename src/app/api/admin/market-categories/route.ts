import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { listMarketCategoryTreeForAdmin, MarketCategoryError } from '@/lib/market-categories-server'
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
    const groups = await listMarketCategoryTreeForAdmin(workspaceSubject)
    return NextResponse.json({
      success: true,
      data: {
        groups: groups.map((group) => ({
          id: group.id,
          title: group.title,
          sortOrder: group.sort_order,
          isActive: group.is_active,
          items: group.items.map((item) => ({
            id: item.id,
            title: item.title,
            sortOrder: item.sort_order,
            isActive: item.is_active,
            defaultImage: item.default_image,
          })),
        })),
      },
    })
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
