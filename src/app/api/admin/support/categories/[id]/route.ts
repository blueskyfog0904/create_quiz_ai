import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'

export const dynamic = 'force-dynamic'

const CategoryUpdateSchema = z.object({
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9_\-]+$/).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  helpText: z.string().trim().max(1000).nullable().optional(),
  guideItems: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  subjectPlaceholder: z.string().trim().max(200).nullable().optional(),
  messagePlaceholder: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

// 문의 관리 권한(support.manage)을 공용 가드로 확인한다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('support.manage')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { supabase: await createClient(), user: { id: guard.access.userId } }
}

// 13번 7절: DB 트리거 guard_support_category_slug 가 문의 달린 카테고리·탈퇴 가림 정책 slug 의 코드 변경을 막는다.
const SLUG_LOCKED_MESSAGE = '문의가 달렸거나 탈퇴 회원 기록 가림에 쓰이는 카테고리라 코드를 바꿀 수 없습니다.'

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = CategoryUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '카테고리 입력값이 올바르지 않습니다.' }, { status: 400 })
  }

  // 숨긴 카테고리를 '사용' 체크로 켜지 않는다(deleted_at 이 남아 회원 화면에 안 보이는 헷갈리는 상태를 만들지 않게) — [다시 사용]으로.
  const { data: current, error: currentError } = await admin.supabase
    .from('support_ticket_categories')
    .select('id, slug, is_active, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 })
  }
  if (!current) {
    return NextResponse.json({ error: '카테고리를 찾을 수 없습니다.' }, { status: 404 })
  }
  if (current.deleted_at && !current.is_active && parsed.data.isActive === true) {
    return NextResponse.json({ error: "숨긴 카테고리는 목록의 [다시 사용]으로 되살려 주세요.", code: 'SUPPORT_CATEGORY_HIDDEN' }, { status: 409 })
  }

  const patch = {
    ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
    ...(parsed.data.helpText !== undefined ? { help_text: parsed.data.helpText } : {}),
    ...(parsed.data.guideItems !== undefined ? { guide_items: parsed.data.guideItems } : {}),
    ...(parsed.data.subjectPlaceholder !== undefined ? { subject_placeholder: parsed.data.subjectPlaceholder } : {}),
    ...(parsed.data.messagePlaceholder !== undefined ? { message_placeholder: parsed.data.messagePlaceholder } : {}),
    ...(parsed.data.sortOrder !== undefined ? { sort_order: parsed.data.sortOrder } : {}),
    ...(parsed.data.isActive !== undefined ? { is_active: parsed.data.isActive } : {}),
    updated_by: admin.user.id,
    updated_at: new Date().toISOString(),
  }

  const { data: category, error } = await admin.supabase
    .from('support_ticket_categories')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.message?.includes('SUPPORT_CATEGORY_SLUG_LOCKED')) {
      return NextResponse.json({ error: SLUG_LOCKED_MESSAGE, code: 'SUPPORT_CATEGORY_SLUG_LOCKED' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await recordAdminAudit({
    actorId: admin.user.id,
    action: 'support_category_update',
    targetType: 'support_ticket_category',
    targetId: id,
    details: {
      slug: category.slug,
      slugChanged: category.slug !== current.slug,
      fields: Object.keys(patch).filter((key) => key !== 'updated_by' && key !== 'updated_at'),
      request: adminRequestMeta(request),
    },
  })

  return NextResponse.json({ success: true, category })
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const { id } = await params
  const { data: category, error } = await admin.supabase
    .from('support_ticket_categories')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      updated_by: admin.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await recordAdminAudit({
    actorId: admin.user.id,
    action: 'support_category_hide',
    targetType: 'support_ticket_category',
    targetId: id,
    details: { slug: category.slug, request: adminRequestMeta(request) },
  })

  return NextResponse.json({ success: true, category })
}
