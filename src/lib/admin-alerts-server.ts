import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'
import type { AdminAccess } from '@/lib/admin-permissions'
import {
  ADMIN_ALERT_RECENT_LIMIT,
  deriveDispatchStatus,
  type AdminAlertEvent,
  type AdminAlertSummary,
} from '@/lib/admin-alerts'

const GAVE_UP_WINDOW_MS = 24 * 60 * 60 * 1000

// 읽지 못한 부분은 던지지 않고 fallback(null·'unknown')으로 내려보낸다.
async function readOr<T>(label: string, fallback: T, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    console.error(`[admin-alerts] ${label} 조회 실패`, error)
    return fallback
  }
}

// 관리자 확인을 마친 요청에서만 부른다.
// admin_events는 관리자 세션으로(조회 정책을 따른다), 전송 상태 표는 service role로 읽는다.
// 처리 대기 건수는 그 계정의 권한(access)에 맞는 항목만 센다.
export async function getAdminAlertSummary(access: AdminAccess): Promise<AdminAlertSummary> {
  const supabase = await createClient()

  const readEvents = () => readOr<AdminAlertEvent[] | null>('최근 알림', null, async () => {
    const { data, error } = await supabase
      .from('admin_events')
      .select('id, kind, severity, title, body, link, delivery, created_at')
      .order('created_at', { ascending: false })
      .limit(ADMIN_ALERT_RECENT_LIMIT)
    if (error) throw error
    return data
  })

  const readDispatchState = () => readOr<{ last_run_at: string | null; last_run_error: string | null } | null>(
    '전송 작업 상태',
    null,
    async () => {
      const { data, error } = await createAdminClient()
        .from('admin_event_dispatch_state')
        .select('last_run_at, last_run_error')
        .maybeSingle()
      if (error) throw error
      return data
    }
  )

  const readGaveUpCount = () => readOr<number | null>('전송 포기 건수', null, async () => {
    const { count, error } = await createAdminClient()
      .from('admin_event_deliveries')
      .select('event_id', { count: 'exact', head: true })
      .gte('gave_up_at', new Date(Date.now() - GAVE_UP_WINDOW_MS).toISOString())
    if (error) throw error
    return count
  })

  const [work, events, dispatchState, gaveUpCount] = await Promise.all([
    getAdminWorkSummary(access),
    readEvents(),
    readDispatchState(),
    readGaveUpCount(),
  ])

  return {
    work,
    events,
    dispatch: {
      status: deriveDispatchStatus(dispatchState, Date.now()),
      gaveUpCount,
    },
  }
}
