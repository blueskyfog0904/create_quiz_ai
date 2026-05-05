import { createClient } from '@/lib/supabase/server'
import { isUuidishString } from '@/lib/question-bank/validation'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  isWorkspaceSubject,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type AvailabilityRow = {
  problem_type_id: string
  available_count: number
}

type RpcError = {
  code?: string
  details?: string | null
  message?: string
}

function resolveRequestedWorkspaceSubject(searchParams: URLSearchParams): WorkspaceSubject | null {
  const requestedSubject = searchParams.get('workspaceSubject') ?? searchParams.get('subject')

  if (!requestedSubject) {
    return DEFAULT_WORKSPACE_SUBJECT
  }

  return isWorkspaceSubject(requestedSubject) ? requestedSubject : null
}

function mapAvailability(row: AvailabilityRow) {
  return {
    problemTypeId: row.problem_type_id,
    availableCount: row.available_count,
  }
}

function getRpcErrorCode(error: RpcError) {
  const errorText = [error.code, error.message, error.details]
    .filter(Boolean)
    .join(' ')

  for (const code of ['INACTIVE_DIMENSION', 'INVALID_SCOPE', 'AUTH_REQUIRED']) {
    if (errorText.includes(code)) {
      return code
    }
  }

  return null
}

function getRpcErrorStatus(error: RpcError) {
  const code = getRpcErrorCode(error)

  if (code === 'AUTH_REQUIRED') {
    return 401
  }

  if (code === 'INACTIVE_DIMENSION' || code === 'INVALID_SCOPE') {
    return 400
  }

  return 500
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = new URL(request.url).searchParams
    const workspaceSubject = resolveRequestedWorkspaceSubject(searchParams)
    const yearId = searchParams.get('yearId')?.trim() ?? ''
    const bookId = searchParams.get('bookId')?.trim() ?? ''

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    if (!isUuidishString(yearId) || !isUuidishString(bookId)) {
      return NextResponse.json({ error: 'Invalid yearId or bookId' }, { status: 400 })
    }

    // Phase 1 source policy: count only user-owned from_community saved questions; the RPC enforces this policy.
    const { data, error } = await supabase.rpc('get_question_bank_availability', {
      p_workspace_subject: workspaceSubject,
      p_year_id: yearId,
      p_book_id: bookId,
    })

    if (error) {
      const status = getRpcErrorStatus(error)

      if (status === 500) {
        console.error('[Question Bank Availability] RPC error:', error)
      }

      return NextResponse.json({ error: getRpcErrorCode(error) ?? 'Failed to fetch availability' }, { status })
    }

    const availability = (data ?? []).map(mapAvailability)

    return NextResponse.json({ availability })
  } catch (error) {
    console.error('[Question Bank Availability] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
