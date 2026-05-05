import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT, isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database } from '@/types/supabase'

const yearSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
  subject: z.enum(['english', 'korean']).optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  label: z.string().trim().min(1, '연도 라벨은 필수입니다'),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
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

export async function GET(request: Request) {
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
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order', { ascending: true })
      .order('year', { ascending: false })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch question bank years' }, { status: 500 })
    }

    return NextResponse.json({ years: data ?? [] })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const body = await request.json()
    const parsed = yearSchema.parse(body)
    const querySubject = new URL(request.url).searchParams.get('subject')
    const workspaceSubject = resolveScopedWorkspaceSubject(parsed.workspace_subject ?? parsed.subject ?? querySubject)

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const payload: Database['public']['Tables']['question_bank_years']['Insert'] = {
      workspace_subject: workspaceSubject,
      year: parsed.year,
      label: parsed.label,
      sort_order: parsed.sort_order,
      is_active: parsed.is_active,
    }

    const { data, error } = await supabase
      .from('question_bank_years')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return duplicateResponse()
      }

      return NextResponse.json({ error: 'Failed to create question bank year' }, { status: 500 })
    }

    return NextResponse.json({ year: data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
