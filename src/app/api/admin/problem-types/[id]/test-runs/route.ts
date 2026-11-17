import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

const getAttemptCount = (attempts: unknown) => (
  Array.isArray(attempts) ? attempts.length : 0
)

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params
  const supabase = await createClient()
  // 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return NextResponse.json({ success: false, error: { code: guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR', message: adminApiGuardMessage(guard) } }, { status: guard.status })
  }

  const { data: runs, error } = await supabase
    .from('problem_type_test_runs')
    .select('id,status,stop_reason,attempts,created_at')
    .eq('problem_type_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'TEST_LOG_LIST_FAILED', message: error.message } }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    runs: (runs || []).map((run) => ({
      id: run.id,
      status: run.status,
      stopReason: run.stop_reason,
      attemptCount: getAttemptCount(run.attempts),
      createdAt: run.created_at,
      logLocation: `/api/admin/problem-types/${id}/test-runs/${run.id}`,
      downloadUrl: `/api/admin/problem-types/${id}/test-runs/${run.id}/download`,
    })),
  })
}
