import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { getAdminDashboard } from '@/lib/admin-dashboard-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'
import { getKstPeriodStarts } from '@/lib/kst-period'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    // Check admin authentication
    // 공통 화면(대시보드)이라 관리자면 통과한다. 권한이 필요한 구역은 아래에서 권한별로 거른다.
    const guard = await requireAdminApiPermission('admin')
    if ('error' in guard && guard.status !== 500) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    // 권한을 읽지 못해도(가드 500) 화면은 열린다. 이때는 관리자 여부만 직접 확인하고, 가입 수·처리 대기는 "확인 불가", 권한 구역은 뺀다.
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
    // 13번 M3: 세션은 다른 회원의 profiles 를 읽지 못하므로 가입 수는 서버 키로 센다(가드 뒤, 건수만 — 개인정보 없음).
    const countSignups = async (since: string) => {
      const { count, error } = await createAdminClient()
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since)
      // 세지 못하면 0이 아니라 null("확인 불가")로 보낸다.
      return error ? null : count
    }

    // 가입 수(회원 조회 권한), 처리 대기(항목별 권한), 매출·판매 지표와 최근 주문·문의는 계정 권한이 있는 구역만 읽는다.
    // 권한을 읽지 못했으면(access null) 숫자를 세지 않고 "확인 불가"로 보낸다.
    const canSeeSignups = access !== null && hasAdminPermission(access, 'members.view')
    const [today, month, work, dashboard] = await Promise.all([
      canSeeSignups ? countSignups(period.todayStart) : null,
      canSeeSignups ? countSignups(period.monthStart) : null,
      getAdminWorkSummary(access),
      access ? getAdminDashboard(access, period) : null,
    ])

    // 13번 8절: 최근 주문·문의에 회원 이메일을 싣기 전에 열람 기록을 남긴다. 남기지 못하면 이메일을 가린다(Q4 가).
    if (access && dashboard) {
      const orders = dashboard.recentOrders && !dashboard.recentOrders.failed ? dashboard.recentOrders.data : []
      const tickets = dashboard.recentTickets && !dashboard.recentTickets.failed ? dashboard.recentTickets.data : []
      const memberIds = [
        ...orders.filter((order) => order.user?.email).map((order) => order.user_id),
        ...tickets.filter((ticket) => ticket.user?.email).map((ticket) => ticket.user_id),
      ]
      const logged = await recordMemberAccess({
        access, screen: 'dashboard', memberIds, fields: ['email'], requestMeta: adminRequestMeta(request),
      })
      if (!logged) {
        for (const order of orders) if (order.user) order.user = { ...order.user, email: null }
        for (const ticket of tickets) if (ticket.user) ticket.user = { ...ticket.user, email: null }
      }
    }

    return NextResponse.json({
      // null = 권한 없음(그리지 않음). 권한을 읽지 못했으면 값만 null인 객체("확인 불가").
      signups: access === null || canSeeSignups ? { today, month } : null,
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
