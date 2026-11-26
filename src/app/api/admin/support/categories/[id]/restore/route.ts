import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { UUID_PATTERN } from '@/lib/admin-orders'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// 13번 7절: 숨긴 카테고리 되살리기. deleted_at = NULL, is_active = true 로 바꾸고 순서(sort_order)는 그대로 둔다.
// 쓰기는 지금처럼 관리자 세션(정책 support.manage)으로 하고, 작업 기록 support_category_restore 를 남긴다.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('support.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 })
  }

  const supabase = await createClient()
  const { data: category, error } = await supabase
    .from('support_ticket_categories')
    .update({
      deleted_at: null,
      is_active: true,
      updated_by: guard.access.userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!category) {
    return NextResponse.json({ error: '숨긴 카테고리를 찾을 수 없습니다. 화면을 새로고침해 주세요.' }, { status: 404 })
  }

  await recordAdminAudit({
    actorId: guard.access.userId,
    action: 'support_category_restore',
    targetType: 'support_ticket_category',
    targetId: id,
    details: { slug: category.slug, request: adminRequestMeta(request) },
  })

  return NextResponse.json({ success: true, category })
}
