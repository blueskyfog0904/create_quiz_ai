import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

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

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { supabase, user }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = CategoryUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '카테고리 입력값이 올바르지 않습니다.' }, { status: 400 })
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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, category })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
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

  return NextResponse.json({ success: true, category })
}
