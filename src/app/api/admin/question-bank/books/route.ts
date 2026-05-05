import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT, isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database } from '@/types/supabase'

const slugSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/, '슬러그는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다')

const bookSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
  subject: z.enum(['english', 'korean']).optional(),
  name: z.string().trim().min(1, '교재명은 필수입니다'),
  slug: slugSchema,
  description: z.string().trim().optional().nullable(),
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
  return NextResponse.json({ error: '이미 존재하는 교재입니다.' }, { status: 409 })
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
      .from('question_bank_books')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch question bank books' }, { status: 500 })
    }

    return NextResponse.json({ books: data ?? [] })
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
    const parsed = bookSchema.parse(body)
    const querySubject = new URL(request.url).searchParams.get('subject')
    const workspaceSubject = resolveScopedWorkspaceSubject(parsed.workspace_subject ?? parsed.subject ?? querySubject)

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const payload: Database['public']['Tables']['question_bank_books']['Insert'] = {
      workspace_subject: workspaceSubject,
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description ?? null,
      sort_order: parsed.sort_order,
      is_active: parsed.is_active,
    }

    const { data, error } = await supabase
      .from('question_bank_books')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return duplicateResponse()
      }

      return NextResponse.json({ error: 'Failed to create question bank book' }, { status: 500 })
    }

    return NextResponse.json({ book: data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
