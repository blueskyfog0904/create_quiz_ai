import { NextRequest, NextResponse } from 'next/server'
import { listAdminAuditTimeline } from '@/lib/admin-audit-log-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'

export const dynamic = 'force-dynamic'

// 작업 기록 조회(계획 U3-5). 대표 관리자만 읽는다. 조회만 한다.
export async function GET(request: NextRequest) {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const searchParams = new URL(request.url).searchParams
  try {
    const result = await listAdminAuditTimeline({
      actor: searchParams.get('actor'),
      action: searchParams.get('action'),
      source: searchParams.get('source'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })
    // 13번 8절: 대상 회원 이메일을 싣기 전에 열람 기록을 남긴다(관리자 계정 대상은 빼고). 남기지 못하면 이메일을 가린다(Q4 가).
    const adminIds = new Set(result.actors.map((actor) => actor.id))
    const logged = await recordMemberAccess({
      access: guard.access,
      screen: 'audit_log',
      memberIds: result.rows.filter((row) => row.targetUserId && row.targetUserEmail && !adminIds.has(row.targetUserId)).map((row) => row.targetUserId),
      fields: ['email'],
      context: { tab: 'actions', page: result.page, count: result.rows.length },
      requestMeta: adminRequestMeta(request),
    })
    const data = logged ? result : {
      ...result,
      rows: result.rows.map((row) => (row.targetUserId && !adminIds.has(row.targetUserId) ? { ...row, targetUserEmail: null } : row)),
    }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    // 표가 아직 없을 때(마이그레이션 적용 전)도 여기로 온다.
    console.error('[admin-audit] 작업 기록을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '작업 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
