import { NextRequest, NextResponse } from 'next/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { listAdminMemberAccessLog, shownAccessLogMemberIds } from '@/lib/admin-member-access-log-view-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'

export const dynamic = 'force-dynamic'

// 13번 8-3: 개인정보 열람 기록 조회. 대표 관리자만 읽는다. 조회만 한다.
// 이 탭을 연 것도 audit_log 로 기록한다(보인 회원 표시 이름 기준). 남기지 못하면 회원 이름을 빼고 보낸다(Q4 가).
export async function GET(request: NextRequest) {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const searchParams = new URL(request.url).searchParams
  try {
    const result = await listAdminMemberAccessLog({
      actor: searchParams.get('actor'),
      screen: searchParams.get('screen'),
      member: searchParams.get('member'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
    })
    const logged = await recordMemberAccess({
      access: guard.access,
      screen: 'audit_log',
      memberIds: shownAccessLogMemberIds(result),
      fields: ['access_log'],
      context: { tab: 'access', page: result.page, memberFilter: Boolean(result.member), count: result.rows.length },
      requestMeta: adminRequestMeta(request),
    })
    const data = logged ? result : {
      ...result,
      rows: result.rows.map((row) => ({ ...row, members: row.members.map((member) => ({ ...member, name: null })) })),
      member: result.member ? { ...result.member, name: null } : null,
    }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    // 표가 아직 없을 때(마이그레이션 적용 전)도 여기로 온다.
    console.error('[admin-member-access-log] 열람 기록을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '열람 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
