import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const problemTypeUpdateSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
  subject: z.enum(['english', 'korean']).optional(),
  type_name: z.string().trim().min(1, '문제유형명은 필수입니다').optional(),
  description: z.string().trim().optional().nullable(),
  sort_order: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
})

async function requireAdminUser(supabase: Awaited<ReturnType<typeof createClient>>) {
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

function duplicateResponse() {
  return NextResponse.json({ error: '이미 존재하는 문제유형입니다.' }, { status: 409 })
}

function notFoundResponse() {
  return NextResponse.json({ error: 'Question bank problem type not found' }, { status: 404 })
}

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params

  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const body = await request.json()
    const parsed = problemTypeUpdateSchema.parse(body)
    const querySubject = new URL(request.url).searchParams.get('subject')
    const workspaceSubject = resolveAdminWorkspaceSubject(parsed.workspace_subject ?? parsed.subject ?? querySubject)
    const payload: Record<string, unknown> = {}

    if (parsed.type_name !== undefined) payload.type_name = parsed.type_name
    if (parsed.description !== undefined) payload.description = parsed.description
    if (parsed.sort_order !== undefined) payload.sort_order = parsed.sort_order
    if (parsed.is_active !== undefined) payload.is_active = parsed.is_active

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('question_bank_problem_types')
      .update(payload)
      .eq('id', params.id)
      .eq('workspace_subject', workspaceSubject)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return duplicateResponse()
      }
      if (error.code === 'PGRST116') {
        return notFoundResponse()
      }

      return NextResponse.json({ error: 'Failed to update question bank problem type' }, { status: 500 })
    }

    return NextResponse.json({ problemType: data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params

  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    const { data, error } = await supabase
      .from('question_bank_problem_types')
      .update({ is_active: false })
      .eq('id', params.id)
      .eq('workspace_subject', workspaceSubject)
      .select('*')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return notFoundResponse()
      }

      return NextResponse.json({ error: 'Failed to deactivate question bank problem type' }, { status: 500 })
    }

    return NextResponse.json({ problemType: data, success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
