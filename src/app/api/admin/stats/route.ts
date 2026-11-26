import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDashboard } from '@/lib/admin-dashboard-server'
import { parseDashboardQuery, resolveDashboardPeriod } from '@/lib/admin-dashboard-period'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'

// 21번 묶음(계획 6절): 대시보드가 기간·과목을 바꿀 때만 부른다(첫 화면은 page.tsx 가 같은 검사·같은 함수로 서버에서 읽음).
// 주소: period=today|7d|30d|month|lastMonth|custom, subject, custom 일 때만 from·to. products=1 이면 상품 현황도 다시 읽는다([새로고침]).
// 최근 목록은 기간과 따로(/api/admin/stats/recent). 응답은 캐시하지 않는다.
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    // 공통 화면(대시보드)이라 관리자면 통과한다. 권한이 필요한 구역은 getAdminDashboard 가 권한별로 거른다.
    const guard = await requireAdminApiPermission('admin')
    if ('error' in guard && guard.status !== 500) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    // 권한을 읽지 못해도(가드 500) 화면은 열린다. 이때는 관리자 여부만 직접 확인하고, 처리 대기는 "확인 불가", 숫자 구역은 뺀다.
    const access = 'error' in guard ? null : guard.access
    if (!access) {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

      if (!profile?.is_admin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // 기간은 한국 시간 기준이다(서버 시간대와 무관). 상대 프리셋은 요청 시각 기준으로 다시 계산한다.
    const url = new URL(request.url)
    const now = new Date()
    const period = resolveDashboardPeriod(parseDashboardQuery(url.searchParams, now), now)
    const [work, dashboard] = await Promise.all([
      getAdminWorkSummary(access),
      access ? getAdminDashboard(access, period, { includeProducts: url.searchParams.get('products') === '1' }) : null,
    ])

    // dashboard null = 권한을 읽지 못함(화면이 '확인 불가' 안내를 띄운다).
    return NextResponse.json({ period, work, dashboard }, { headers: NO_STORE })
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500, headers: NO_STORE }
    )
  }
}
