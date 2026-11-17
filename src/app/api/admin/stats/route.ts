import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminDashboard } from '@/lib/admin-dashboard-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'
import { getKstPeriodStarts } from '@/lib/kst-period'

export async function GET() {
  try {
    const supabase = await createClient()

    // Check admin authentication
    // 공통 화면(대시보드)이라 관리자면 통과한다. 권한이 필요한 구역은 아래에서 권한별로 거른다.
    const guard = await requireAdminApiPermission('admin')
    if ('error' in guard && guard.status !== 500) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    // 권한을 읽지 못해도(가드 500) 가입 수·처리 대기는 보여 준다. 이때는 관리자 여부만 직접 확인하고 권한이 필요한 구역은 뺀다.
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

    // 오늘·이번 달은 한국 시간 기준이다(서버 시간대와 무관).
    const period = getKstPeriodStarts()
    const countSignups = async (since: string) => {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since)
      // 세지 못하면 0이 아니라 null("확인 불가")로 보낸다.
      return error ? null : count
    }

    // 매출·판매 지표와 최근 주문·문의는 계정 권한이 있는 구역만 읽는다.
    const [today, month, work, dashboard] = await Promise.all([
      countSignups(period.todayStart),
      countSignups(period.monthStart),
      getAdminWorkSummary(),
      access ? getAdminDashboard(access, period) : null,
    ])

    return NextResponse.json({
      signups: { today, month },
      work,
      metrics: dashboard?.metrics ?? null,
      recentOrders: dashboard?.recentOrders ?? null,
      recentTickets: dashboard?.recentTickets ?? null,
      period: { year: period.year, month: period.month },
    })
  } catch (error) {
    console.error('Error fetching admin stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}
