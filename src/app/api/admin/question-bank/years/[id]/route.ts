import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT, isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database } from '@/types/supabase'

const yearUpdateSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
  subject: z.enum(['english', 'korean']).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  label: z.string().trim().min(1, '연도 라벨은 필수입니다').optional(),
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

function resolveScopedWorkspaceSubject(value: string | null | undefined): WorkspaceSubject | null {
  if (!value) {
    return DEFAULT_WORKSPACE_SUBJECT
  }

  return isWorkspaceSubject(value) ? value : null
}

function duplicateResponse() {
  return NextResponse.json({ error: '이미 존재하는 연도입니다.' }, { status: 409 })
}

function notFoundResponse() {
  return NextResponse.json({ error: 'Question bank year not found' }, { status: 404 })
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
    const parsed = yearUpdateSchema.parse(body)
    const querySubject = new URL(request.url).searchParams.get('subject')
    const workspaceSubject = resolveScopedWorkspaceSubject(parsed.workspace_subject ?? parsed.subject ?? querySubject)

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const payload: Database['public']['Tables']['question_bank_years']['Update'] = {}

    if (parsed.year !== undefined) payload.year = parsed.year
    if (parsed.label !== undefined) payload.label = parsed.label
    if (parsed.sort_order !== undefined) payload.sort_order = parsed.sort_order
    if (parsed.is_active !== undefined) payload.is_active = parsed.is_active

    const { data, error } = await supabase
      .from('question_bank_years')
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

      return NextResponse.json({ error: 'Failed to update question bank year' }, { status: 500 })
    }

    return NextResponse.json({ year: data })
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

    const workspaceSubject = resolveScopedWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('question_bank_years')
      .update({ is_active: false })
      .eq('id', params.id)
      .eq('workspace_subject', workspaceSubject)
      .select('*')
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return notFoundResponse()
      }

      return NextResponse.json({ error: 'Failed to deactivate question bank year' }, { status: 500 })
    }

    return NextResponse.json({ year: data, success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
