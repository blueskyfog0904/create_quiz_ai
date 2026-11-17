import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

const CategorySchema = z.object({
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9_\-]+$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  helpText: z.string().trim().max(1000).nullable().optional(),
  guideItems: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
  subjectPlaceholder: z.string().trim().max(200).nullable().optional(),
  messagePlaceholder: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
})

// 문의 관리 권한(support.manage)을 공용 가드로 확인한다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('support.manage')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { supabase: await createClient(), user: { id: guard.access.userId } }
}

export async function GET() {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const { data, error } = await admin.supabase
    .from('support_ticket_categories')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ categories: data || [] })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = CategorySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '카테고리 입력값이 올바르지 않습니다.' }, { status: 400 })
  }

  const { data: category, error } = await admin.supabase
    .from('support_ticket_categories')
    .insert({
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      help_text: parsed.data.helpText ?? null,
      guide_items: parsed.data.guideItems ?? [],
      subject_placeholder: parsed.data.subjectPlaceholder ?? null,
      message_placeholder: parsed.data.messagePlaceholder ?? null,
      sort_order: parsed.data.sortOrder ?? 0,
      is_active: parsed.data.isActive ?? true,
      created_by: admin.user.id,
      updated_by: admin.user.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, category })
}
