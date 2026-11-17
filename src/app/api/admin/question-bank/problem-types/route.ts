import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const problemTypeSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
  subject: z.enum(['english', 'korean']).optional(),
  type_name: z.string().trim().min(1, '문제유형명은 필수입니다'),
  description: z.string().trim().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
  is_active: z.boolean().default(true),
})

// 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
async function requireAdminUser() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

function duplicateResponse() {
  return NextResponse.json({ error: '이미 존재하는 문제유형입니다.' }, { status: 409 })
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser()

    if (admin.error) {
      return admin.error
    }

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

    const { data, error } = await supabase
      .from('question_bank_problem_types')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order', { ascending: true })
      .order('type_name', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch question bank problem types' }, { status: 500 })
    }

    return NextResponse.json({ problemTypes: data ?? [] })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser()

    if (admin.error) {
      return admin.error
    }

    const body = await request.json()
    const parsed = problemTypeSchema.parse(body)
    const querySubject = new URL(request.url).searchParams.get('subject')
    const workspaceSubject = resolveAdminWorkspaceSubject(parsed.workspace_subject ?? parsed.subject ?? querySubject)

    const payload = {
      workspace_subject: workspaceSubject,
      type_name: parsed.type_name,
      description: parsed.description ?? null,
      sort_order: parsed.sort_order,
      is_active: parsed.is_active,
    }

    const { data, error } = await supabase
      .from('question_bank_problem_types')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        return duplicateResponse()
      }

      return NextResponse.json({ error: 'Failed to create question bank problem type' }, { status: 500 })
    }

    return NextResponse.json({ problemType: data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
