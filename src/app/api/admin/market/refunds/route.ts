import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { listMarketRefundRequestsForAdmin } from '@/lib/market-refunds'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

// 마켓 환불 승인·거부 권한(refunds.market)을 공용 가드로 확인한다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('refunds.market')
  if ('error' in guard) return { error: guard.error, status: guard.status } as const
  return { user: { id: guard.access.userId } } as const
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
