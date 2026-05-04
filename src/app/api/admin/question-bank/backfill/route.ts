import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT, isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Json } from '@/types/supabase'

const BACKFILL_BATCH_SIZE = 500
const uuidSchema = z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'UUID 형식이 올바르지 않습니다')

const backfillRequestSchema = z.object({
  sourceQuestionIds: z.array(uuidSchema).min(1, '백필할 문제를 선택해주세요').max(BACKFILL_BATCH_SIZE, '한 번에 최대 500개까지 백필할 수 있습니다'),
  yearId: uuidSchema,
  bookId: uuidSchema,
  dryRun: z.boolean().default(true),
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

function parseInteger(value: string | null, fallback: number) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function buildFilterJson(searchParams: URLSearchParams): Json {
  const filter: Record<string, string> = {}

  for (const key of ['search', 'yearId', 'bookId', 'problemTypeId']) {
    const value = searchParams.get(key)?.trim()

    if (value) {
      filter[key] = value
    }
  }

  return filter
}

function getRpcStatus(message?: string) {
  if (!message) {
    return 500
  }

  if (message.includes('AUTH_REQUIRED')) {
    return 401
  }
  if (message.includes('ADMIN_REQUIRED')) {
    return 403
  }
  if (
    message.includes('INVALID_SCOPE')
    || message.includes('INACTIVE_DIMENSION')
    || message.includes('INVALID_SOURCE')
    || message.includes('BACKFILL_BATCH_TOO_LARGE')
  ) {
    return 400
  }

  return 500
}

function rpcErrorResponse(error: { message?: string }) {
  const status = getRpcStatus(error.message)

  return NextResponse.json({ error: error.message ?? 'Question bank backfill failed' }, { status })
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const admin = await requireAdminUser(supabase)

    if (admin.error) {
      return admin.error
    }

    const searchParams = new URL(request.url).searchParams
    const workspaceSubject = resolveScopedWorkspaceSubject(searchParams.get('subject'))

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const limit = Math.max(0, Math.min(parseInteger(searchParams.get('limit'), 100), BACKFILL_BATCH_SIZE))
    const offset = Math.max(0, parseInteger(searchParams.get('offset'), 0))
    const filterJson = buildFilterJson(searchParams)

    const { data: auditData, error: auditError } = await supabase.rpc('admin_audit_question_bank_metadata', {
      p_workspace_subject: workspaceSubject,
      p_filter: filterJson,
    })

    if (auditError) {
      return rpcErrorResponse(auditError)
    }

    const { data: candidateData, error: candidateError } = await supabase.rpc('admin_list_question_bank_backfill_candidates', {
      p_workspace_subject: workspaceSubject,
      p_filter: filterJson,
      p_limit: limit,
      p_offset: offset,
    })

    if (candidateError) {
      return rpcErrorResponse(candidateError)
    }

    const candidates = candidateData ?? []
    const firstCandidate = candidates[0]
    const total = typeof firstCandidate?.total_count === 'number'
      ? firstCandidate.total_count
      : Number(firstCandidate?.total_count ?? 0)

    return NextResponse.json({
      audit: auditData?.[0] ?? null,
      candidates,
      pagination: {
        limit,
        offset,
        total,
      },
    })
  } catch (error) {
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

    const searchParams = new URL(request.url).searchParams
    const workspaceSubject = resolveScopedWorkspaceSubject(searchParams.get('subject'))

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const parsed = backfillRequestSchema.parse(await request.json())
    const { data, error } = await supabase.rpc('backfill_question_bank_metadata', {
      p_workspace_subject: workspaceSubject,
      p_source_question_ids: parsed.sourceQuestionIds,
      p_year_id: parsed.yearId,
      p_book_id: parsed.bookId,
      p_dry_run: parsed.dryRun,
    })

    if (error) {
      return rpcErrorResponse(error)
    }

    return NextResponse.json({ result: data?.[0] ?? { admin_updated_count: 0, copied_updated_count: 0 }, dryRun: parsed.dryRun })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
