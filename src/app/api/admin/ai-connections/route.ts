import { NextResponse } from 'next/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { listProviderConnectionsForAdmin } from '@/lib/ai/provider-connections'

export const dynamic = 'force-dynamic'

// 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

export async function GET() {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  try {
    const connections = await listProviderConnectionsForAdmin()
    return NextResponse.json({ data: connections })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch AI provider connections',
    }, { status: 500 })
  }
}
