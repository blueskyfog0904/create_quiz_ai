import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listMarketRefundRequestsForAdmin } from '@/lib/market-refunds'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized', status: 401 } as const
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: 'Forbidden: Admin only', status: 403 } as const
  }

  return { user } as const
}

function normalizeWorkspaceSubject(value?: string | null): WorkspaceSubject {
  return value === 'korean' ? 'korean' : DEFAULT_WORKSPACE_SUBJECT
}

export async function GET(request: NextRequest) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ success: false, error: adminCheck.error }, { status: adminCheck.status })
  }

  const status = request.nextUrl.searchParams.get('status') || 'pending'
  const workspaceSubject = normalizeWorkspaceSubject(request.nextUrl.searchParams.get('subject'))
  const requests = await listMarketRefundRequestsForAdmin({ workspaceSubject, status })

  return NextResponse.json({
    success: true,
    data: requests,
  })
}
