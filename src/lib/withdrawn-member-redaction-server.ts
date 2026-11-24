import 'server-only'

import { createAdminClient } from '@/lib/supabase/bypass'
import { withdrawalText } from '@/lib/member-withdrawal'
import { readMemberWithdrawalPolicy, readWithdrawnUserIds } from '@/lib/member-withdrawal-server'

// service_role 경로의 탈퇴 회원 가림(계획 6-6). 화면 세션은 RESTRICTIVE RLS 가 탈퇴 회원 문의·자료 환불을 숨기지만,
// 서버 키로 읽는 경로는 코드가 가린다: 문의 제목은 '탈퇴 회원 문의'(DB 문구), 본문·답변·환불 사유·메모는 내보내지 않는다.

// 10번 마이그레이션 전(profiles.withdrawn_at 칸 없음, 42703)에는 탈퇴 회원이 있을 수 없으므로 빈 집합으로 본다.
// 그 밖의 실패는 그대로 올린다(가림 없이 내보내지 않게).
export async function readWithdrawnUserIdsForRedaction(userIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  try {
    return await readWithdrawnUserIds(userIds)
  } catch (error) {
    if (error instanceof Error && error.message.includes('42703')) return new Set()
    throw error
  }
}

// 탈퇴 회원 문의 제목 대신 보여 주는 문구(DB texts.adminEventTitle). 읽지 못하면 예외 — 원래 제목을 대신 내보내지 않는다.
export async function readWithdrawnTicketTitle(): Promise<string> {
  const title = withdrawalText(await readMemberWithdrawalPolicy(), 'adminEventTitle')
  if (!title) throw new Error('MEMBER_WITHDRAW_POLICY_UNAVAILABLE')
  return title
}

// 행마다 탈퇴 회원 여부(memberWithdrawn)를 붙이고, 탈퇴 회원 행은 redact 로 가린다. 탈퇴 회원 행이 없으면 문구를 읽지 않는다.
export async function markWithdrawnRows<T>(
  rows: readonly T[],
  userIdOf: (row: T) => string | null | undefined,
  redact: (row: T, title: string) => T
): Promise<Array<T & { memberWithdrawn: boolean }>> {
  const withdrawn = await readWithdrawnUserIdsForRedaction(rows.map(userIdOf))
  const title = withdrawn.size > 0 ? await readWithdrawnTicketTitle() : ''
  return rows.map((row) => {
    const userId = userIdOf(row)
    const memberWithdrawn = Boolean(userId && withdrawn.has(userId))
    return { ...(memberWithdrawn ? redact(row, title) : row), memberWithdrawn }
  })
}

export interface WithdrawnSupportTicketRow {
  id: string
  user_id: string
  status: string
  created_at: string
}

const WITHDRAWN_TICKET_LIST_LIMIT = 100

// 관리자 문의 목록의 '탈퇴 회원 · 법정 보존 N건' 줄(6-6). 화면 세션에서는 RLS 로 안 보이므로 서버 키로 건수를 센다.
// 제목·본문은 읽지 않는다(대표가 사유를 적으면 read_withdrawn_member_ticket 로 열람 기록과 함께 연다). 목록 행은 대표에게만.
// 10번 마이그레이션 전(칸 없음)에는 0건. 읽지 못하면 null.
export async function readWithdrawnSupportTickets(options: { withRows: boolean }): Promise<{
  count: number
  rows: WithdrawnSupportTicketRow[]
} | null> {
  const admin = createAdminClient()
  const { data: profiles, error: profileError } = await admin.from('profiles').select('id').not('withdrawn_at', 'is', null)
  if (profileError) {
    if (profileError.code === '42703') return { count: 0, rows: [] }
    console.error('[withdrawn-member] 탈퇴 회원을 읽지 못했습니다.', { code: profileError.code })
    return null
  }
  const userIds = (profiles ?? []).map((profile) => profile.id)
  if (userIds.length === 0) return { count: 0, rows: [] }
  const { data, count, error } = await admin.from('support_tickets')
    .select('id, user_id, status, created_at', { count: 'exact' })
    .in('user_id', userIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.withRows ? WITHDRAWN_TICKET_LIST_LIMIT : 1)
  if (error) {
    console.error('[withdrawn-member] 탈퇴 회원 문의를 읽지 못했습니다.', { code: error.code })
    return null
  }
  return { count: count ?? 0, rows: options.withRows ? data ?? [] : [] }
}

// 문의 한 건이 탈퇴 회원 것인지(관리자 문의 링크 ?ticket= 가 RLS 로 안 열릴 때 안내용). 읽지 못하면 false.
export async function isWithdrawnMemberTicket(ticketId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from('support_tickets').select('user_id').eq('id', ticketId).maybeSingle()
  if (error || !data) return false
  try {
    return (await readWithdrawnUserIdsForRedaction([data.user_id])).has(data.user_id)
  } catch {
    return false
  }
}

// 탈퇴 회원 id 전체(목록 화면용). 10번 마이그레이션 전(칸 없음)에는 빈 목록. 읽지 못하면 예외.
async function readAllWithdrawnUserIds(): Promise<string[]> {
  const { data, error } = await createAdminClient().from('profiles').select('id').not('withdrawn_at', 'is', null)
  if (error) {
    if (error.code === '42703') return []
    throw new Error(`탈퇴 회원 조회 실패: ${error.code ?? ''}`)
  }
  return (data ?? []).map((row) => row.id)
}

// 자료 환불 목록(6-6): 화면 세션 목록에서는 RLS 로 탈퇴 회원 행이 빠진다. 그 행을 서버 키로 읽어 사유·메모를 가리고 '탈퇴 회원'으로 붙인다.
export async function readWithdrawnMarketRefundRequests() {
  const userIds = await readAllWithdrawnUserIds()
  if (userIds.length === 0) return []
  const { data, error } = await createAdminClient()
    .from('market_refund_requests')
    .select('*, user:profiles!market_refund_requests_user_id_fkey(email, display_tag), item:market_items!market_refund_requests_item_id_fkey(title)')
    .in('user_id', userIds)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`탈퇴 회원 자료 환불 조회 실패: ${error.code ?? ''}`)
  return (data ?? []).map((row) => ({ ...row, reason: null, admin_note: null, memberWithdrawn: true }))
}
