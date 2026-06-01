import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
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
