import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'
import { getKstPeriodStarts } from '@/lib/kst-period'

export async function GET() {
  try {
    const supabase = await createClient()

    // Check admin authentication
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

    const [today, month, work] = await Promise.all([
      countSignups(period.todayStart),
      countSignups(period.monthStart),
      getAdminWorkSummary(),
    ])

    return NextResponse.json({
      signups: { today, month },
      work,
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
