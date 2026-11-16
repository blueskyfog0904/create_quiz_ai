import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'
import {
  ADMIN_ALERT_RECENT_LIMIT,
  capUnreadCount,
  deriveDispatchStatus,
  isLaterTimestamp,
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
// admin_events는 관리자 세션으로(조회 정책을 따른다), 전송 상태·확인 시각 표는 service role로 읽는다.
export async function getAdminAlertSummary(adminId: string): Promise<AdminAlertSummary> {
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

  const readUnreadCount = () => readOr<number | null>(
    '미확인 건수',
    null,
    async () => {
      const { data: seen, error: seenError } = await createAdminClient()
        .from('admin_event_reads')
        .select('last_seen_at')
        .eq('admin_id', adminId)
        .maybeSingle()
      if (seenError) throw seenError
      const lastSeenAt = seen?.last_seen_at ?? null

      let query = supabase.from('admin_events').select('id', { count: 'exact', head: true })
      if (lastSeenAt) query = query.gt('created_at', lastSeenAt)
      const { count, error } = await query
      if (error) throw error
      return capUnreadCount(count, lastSeenAt)
    }
  )

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

  const [work, events, unreadCount, dispatchState, gaveUpCount] = await Promise.all([
    getAdminWorkSummary(),
    readEvents(),
    readUnreadCount(),
    readDispatchState(),
    readGaveUpCount(),
  ])

  return {
    work,
    events,
    unreadCount,
    dispatch: {
      status: deriveDispatchStatus(dispatchState, Date.now()),
      gaveUpCount,
    },
  }
}

// 이 관리자가 화면에서 본 가장 최근 이벤트(eventId)까지 확인했다고 기록한다.
// 확인 시각은 서버의 현재 시각이 아니라 그 이벤트의 created_at이다(보지 못한 알림이 확인 처리되지 않게).
// 시각은 DB가 준 문자열 그대로 쓴다(Date로 다시 만들면 마이크로초가 잘린다).
export async function markAdminAlertsSeen(adminId: string, eventId: string): Promise<'ok' | 'not_found' | 'failed'> {
  try {
    // 이벤트는 관리자 세션으로 읽는다(볼 수 없는 이벤트로는 확인 시각을 옮길 수 없다).
    const supabase = await createClient()
    const { data: event, error: eventError } = await supabase
      .from('admin_events')
      .select('created_at')
      .eq('id', eventId)
      .maybeSingle()
    if (eventError) throw eventError
    if (!event) return 'not_found'

    const { data: seen, error: seenError } = await createAdminClient()
      .from('admin_event_reads')
      .select('last_seen_at')
      .eq('admin_id', adminId)
      .maybeSingle()
    if (seenError) throw seenError

    // 확인 시각은 뒤로 돌리지 않는다.
    if (isLaterTimestamp(event.created_at, seen?.last_seen_at ?? null)) {
      const { error } = await createAdminClient()
        .from('admin_event_reads')
        .upsert({ admin_id: adminId, last_seen_at: event.created_at })
      if (error) throw error
    }
    return 'ok'
  } catch (error) {
    console.error('[admin-alerts] 확인 시각 기록 실패', error)
    return 'failed'
  }
}
