import type { AdminWorkSummary } from '@/lib/admin-work-summary-server'

// 관리자 알림(종·토스트·메뉴 배지)이 쓰는 형식과 판정 규칙. 서버·브라우저·테스트가 같이 쓰므로 순수 함수만 둔다.

export interface AdminAlertEvent {
  id: string
  kind: string
  severity: string
  title: string
  body: string | null
  link: string
  // 'screen'이면 화면 목록·토스트에만 남기고 소리·브라우저 알림은 내지 않는다.
  delivery: string
  created_at: string
}

export type AdminAlertDispatchStatus = 'ok' | 'not_configured' | 'config_error' | 'stalled' | 'unknown'

// 읽지 못한 값은 0이 아니라 null('unknown')이다.
export interface AdminAlertSummary {
  work: AdminWorkSummary
  events: AdminAlertEvent[] | null
  unreadCount: number | null
  dispatch: {
    status: AdminAlertDispatchStatus
    gaveUpCount: number | null
  }
}

// 처리 대기 항목: 어떤 숫자를, 어떤 이름으로, 어느 화면에서 처리하는지(대시보드·알림·메뉴 배지가 같이 쓴다)
export const ADMIN_WORK_ITEMS: Array<{ key: keyof AdminWorkSummary; label: string; href: string }> = [
  { key: 'paymentAlertOpen', label: '미해소 결제 경보', href: '/admin/refunds' },
  { key: 'paymentOrderReview', label: '수동 확인이 필요한 결제 주문', href: '/admin/refunds' },
  { key: 'refundAttention', label: '충전 환불 — 재처리·수동 확인', href: '/admin/refunds' },
  { key: 'refundPending', label: '충전 환불 — 승인 대기', href: '/admin/refunds' },
  { key: 'marketRefundPending', label: '문제마켓 환불 대기', href: '/admin/refunds' },
  { key: 'supportPending', label: '답변 대기 문의', href: '/admin/support' },
]

export const ADMIN_ALERT_RECENT_LIMIT = 20
export const ADMIN_ALERT_TOAST_BATCH_MS = 5_000
export const ADMIN_ALERT_POLL_MS = 30_000
// 실시간 연결이 살아 있어 보여도(토큰 문제로 이벤트만 안 오는 경우 대비) 이 간격으로는 다시 조회한다.
export const ADMIN_ALERT_SAFETY_POLL_MS = 5 * 60_000
// 전송 작업은 15초마다 돈다. 2분 넘게 흔적이 없으면 멈춘 것으로 본다.
const DISPATCH_STALL_MS = 2 * 60 * 1000

export function deriveDispatchStatus(
  state: { last_run_at: string | null; last_run_error: string | null } | null,
  nowMs: number
): AdminAlertDispatchStatus {
  if (!state) return 'unknown'
  if (state.last_run_error === 'WEBHOOK_NOT_CONFIGURED') return 'not_configured'
  if (!state.last_run_at || nowMs - new Date(state.last_run_at).getTime() > DISPATCH_STALL_MS) return 'stalled'
  if (state.last_run_error) return 'config_error'
  return 'ok'
}

// 아직 한 번도 확인하지 않은 관리자는 최근 목록 크기까지만 센다.
export function capUnreadCount(count: number | null, lastSeenAt: string | null): number | null {
  if (count === null) return null
  return lastSeenAt === null ? Math.min(count, ADMIN_ALERT_RECENT_LIMIT) : count
}

// DB가 준 시각 문자열끼리 마이크로초까지 비교한다(Date는 밀리초에서 잘린다). than이 null이면 항상 더 늦다.
export function isLaterTimestamp(value: string, than: string | null): boolean {
  if (than === null) return true
  const seconds = (text: string) => Math.floor(Date.parse(text) / 1000)
  const micros = (text: string) => Number((/\.(\d+)/.exec(text)?.[1] ?? '').padEnd(6, '0').slice(0, 6))
  const difference = seconds(value) - seconds(than)
  return difference !== 0 ? difference > 0 : micros(value) > micros(than)
}

// 폴링에서 늘어난 미확인 건수. 어느 한쪽이라도 확인 불가면 0(알리지 않는다).
export function unreadIncrease(previous: number | null, next: number | null): number {
  if (previous === null || next === null) return 0
  return Math.max(0, next - previous)
}

// 5초 안에 모인 이벤트를 토스트 하나로: 1건이면 그대로, 여러 건이면 "새 알림 N건" + 첫 제목.
export function summarizeToastBatch(events: readonly AdminAlertEvent[]) {
  const [first] = events
  if (events.length === 1) {
    return { title: first.title, description: first.body ?? undefined, link: first.link }
  }
  return { title: `새 알림 ${events.length}건`, description: first.title, link: first.link }
}

// 소리·브라우저 알림을 낼 이벤트인지(화면 전용은 조용히).
export function isLoudAlertEvent(event: Pick<AdminAlertEvent, 'delivery'>) {
  return event.delivery !== 'screen'
}

// 메뉴(href)에 붙일 처리 대기 건수. 해당 없는 메뉴는 undefined, 하나라도 세지 못했으면 null("확인 불가").
// work가 null이면(요약 조회 실패) 배지가 붙는 메뉴는 모두 null이다.
export function menuBadgeCount(href: string, work: AdminWorkSummary | null): number | null | undefined {
  const items = ADMIN_WORK_ITEMS.filter((item) => item.href === href)
  if (items.length === 0) return undefined
  if (!work) return null
  let total = 0
  for (const item of items) {
    const value = work[item.key]
    if (value === null) return null
    total += value
  }
  return total
}

// 전송 상태 줄: 정상이면 빈 배열. 읽지 못한 값은 "확인 불가"로 드러낸다.
export function dispatchStatusMessages(dispatch: AdminAlertSummary['dispatch']): string[] {
  const messages: string[] = []
  if (dispatch.status === 'not_configured') messages.push('슬랙 알림 미설정')
  if (dispatch.status === 'config_error') messages.push('통지 설정 오류')
  if (dispatch.status === 'stalled') messages.push('통지 작업 멈춤')
  if (dispatch.status === 'unknown') messages.push('통지 상태 확인 불가')
  if (dispatch.gaveUpCount === null) messages.push('통지 실패 건수 확인 불가')
  else if (dispatch.gaveUpCount > 0) messages.push(`통지 실패 ${dispatch.gaveUpCount}건`)
  return messages
}
