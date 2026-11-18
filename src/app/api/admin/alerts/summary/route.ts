import { NextResponse } from 'next/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { getAdminAlertSummary } from '@/lib/admin-alerts-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {

    // Check admin authentication
    // 공통 화면(알림 종·배지)이라 관리자면 통과한다.
    const guard = await requireAdminApiPermission('admin')
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    return NextResponse.json(await getAdminAlertSummary(guard.access))
  } catch (error) {
    console.error('Error fetching admin alert summary:', error)
    return NextResponse.json({ error: 'Failed to fetch alert summary' }, { status: 500 })
  }
}
