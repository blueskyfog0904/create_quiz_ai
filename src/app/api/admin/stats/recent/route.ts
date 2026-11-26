import { NextResponse } from 'next/server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { canSeeRecentTab, getDashboardRecent, isDashboardRecentTab } from '@/lib/admin-dashboard-server'
import { dashboardPermissions } from '@/lib/admin-dashboard-fields'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

// 21번 묶음(계획 6절): 대시보드 최근 목록 탭 하나(tab=market|charge|support). 기간과 무관하다.
// 화면은 한 번 읽은 탭을 [새로고침] 전까지 다시 부르지 않는다. 요청 하나 = 열람 기록 1행(이메일).
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  try {
    const guard = await requireAdminApiPermission(['orders.view', 'support.manage'])
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status, headers: NO_STORE })
    }

    const tab = new URL(request.url).searchParams.get('tab')
    if (!isDashboardRecentTab(tab)) {
      return NextResponse.json({ error: '목록 종류가 올바르지 않습니다.' }, { status: 400, headers: NO_STORE })
    }
    // 자료 구매·충전 주문은 주문 조회 권한, 답변 대기 문의는 문의 권한
    if (!canSeeRecentTab(dashboardPermissions(guard.access), tab)) {
      return NextResponse.json({ error: '이 목록을 볼 권한이 없습니다.' }, { status: 403, headers: NO_STORE })
    }

    const recent = await getDashboardRecent(guard.access, tab, adminRequestMeta(request))
    return NextResponse.json(recent, { headers: NO_STORE })
  } catch (error) {
    console.error('Error fetching dashboard recent list:', error)
    return NextResponse.json({ error: 'Failed to fetch recent list' }, { status: 500, headers: NO_STORE })
  }
}
