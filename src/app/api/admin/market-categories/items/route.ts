import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createCategoryItem, MarketCategoryError } from '@/lib/market-categories-server'
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

const CreateSchema = z.object({
  group_id: z.string().uuid(),
  title: z.string().min(1).max(120),
  sort_order: z.number().int().optional(),
})

export async function POST(request: NextRequest) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const item = await createCategoryItem({
      groupId: parsed.data.group_id,
      title: parsed.data.title,
      sortOrder: parsed.data.sort_order,
    })
    return NextResponse.json({ success: true, data: item }, { status: 201 })
  } catch (error) {
    if (error instanceof MarketCategoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '카테고리 항목을 생성하지 못했습니다.' },
      { status: 500 }
    )
  }
}
