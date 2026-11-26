import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { hasAdminPermission, type AdminAccess } from '@/lib/admin-permissions'
import { readMemberSuspensionPolicyUncached } from '@/lib/member-suspension-policy-server'
import {
  describeMemberSuspensionError,
  isMemberSuspensionActive,
  parseMemberRefundDeadlines,
  type MemberRefundDeadlines,
  type MemberSuspensionPolicy,
  type MemberSuspensionScope,
} from '@/lib/member-suspension'

// 12번 묶음(계획 6-2): 회원 상세의 '이용 정지'·'관리자 메모' 구역 읽기와, 관리자 API 가 부르는 DB 함수 호출.
// 쓰기는 모두 DB 함수(SECURITY DEFINER)가 한다 — 권한(대표·members.suspend·members.memo)과 작업 기록도 함수가 다시 본다.
// 화면 권한 표(6-2): 구역·이력·메모 보기 members.view, 기한 날짜·경고 members.suspend, 대기 건수 orders.view, 유료 잔액 credits.view.

const HISTORY_LIMIT = 20
// 새 표·함수(12번)는 생성된 타입에 아직 없으므로 타입 없는 클라이언트로 부른다.
const db = () => createAdminClient() as unknown as SupabaseClient
const NOTE_LIMIT = 50

export interface MemberSuspensionRow {
  id: string
  scope: MemberSuspensionScope
  blocks_download: boolean
  reason_code: string
  reason_label: string
  member_reason: string
  internal_note: string
  starts_at: string
  ends_at: string | null
  created_by: string
  lifted_at: string | null
  lifted_by: string | null
  lift_reason: string | null
  notified_via: 'screen' | 'email' | 'phone' | null
  notified_at: string | null
  notice_summary: string | null
  first_seen_at: string | null
  created_at: string
}

export interface MemberAdminNoteRow {
  id: string
  body: string
  created_by: string
  created_at: string
  deleted_at: string | null
  deleted_by: string | null
  redacted_at: string | null
  redacted_by: string | null
}

const SUSPENSION_COLUMNS = 'id, scope, blocks_download, reason_code, reason_label, member_reason, internal_note, starts_at, ends_at, created_by, lifted_at, lifted_by, lift_reason, notified_via, notified_at, notice_summary, first_seen_at, created_at'
const NOTE_COLUMNS = 'id, body, created_by, created_at, deleted_at, deleted_by, redacted_at, redacted_by'

// 처리한 관리자 표시(관리자 계정 이메일). 계정을 지웠으면 표시가 없다(id 만 남음).
async function readActorLabels(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return {} as Record<string, string>
  const { data, error } = await db().from('profiles').select('id, email').in('id', unique)
  if (error) throw new Error(error.message)
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.email ?? row.id])) as Record<string, string>
}

async function countHead(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

// 정지 창의 대기 주문·환불 요청 건수(orders.view). 진행 중 결제와 심사 중 환불만 센다.
async function readPendingCounts(userId: string) {
  const head = { count: 'exact', head: true } as const
  const [paymentOrders, pointRefunds, marketRefunds] = await Promise.all([
    countHead(createPaymentAdminClient().from('payment_orders').select('id', head).eq('user_id', userId)
      .not('status', 'in', '(completed,refunded,failed,expired)')),
    countHead(createPaymentAdminClient().from('refund_requests').select('id', head).eq('user_id', userId)
      .in('status', ['pending_review', 'processing', 'retryable_failed', 'manual_review'])),
    countHead(db().from('market_refund_requests').select('id', head).eq('user_id', userId).eq('status', 'pending')),
  ])
  return { paymentOrders, pointRefunds, marketRefunds }
}

export interface MemberSuspensionSectionData {
  withdrawn: boolean
  history: MemberSuspensionRow[]
  active: MemberSuspensionRow | null
  policy: MemberSuspensionPolicy | null
  actorLabels: Record<string, string>
  // members.suspend 가 없으면 null(읽지 않음). failed 는 읽지 못함.
  deadlines: { failed: false; data: Omit<MemberRefundDeadlines, 'paidBalance'> } | { failed: true } | null
  // credits.view 가 없으면 null
  paidBalance: number | null
  // orders.view 가 없으면 null
  pending: { failed: false; data: { paymentOrders: number; pointRefunds: number; marketRefunds: number } } | { failed: true } | null
  databaseNow: string
}

// '이용 정지' 구역. 탈퇴 회원은 정지 행이 익명화로 지워졌으므로 읽지 않는다(범위·분류·기간은 작업 기록).
export async function readMemberSuspensionSection(access: AdminAccess, userId: string, withdrawnAt: string | null): Promise<MemberSuspensionSectionData> {
  const databaseNow = new Date().toISOString()
  if (withdrawnAt) {
    return { withdrawn: true, history: [], active: null, policy: null, actorLabels: {}, deadlines: null, paidBalance: null, pending: null, databaseNow }
  }
  const canSuspend = hasAdminPermission(access, 'members.suspend')
  const [historyResult, policy] = await Promise.all([
    db().from('member_suspensions').select(SUSPENSION_COLUMNS).eq('user_id', userId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_LIMIT),
    readMemberSuspensionPolicyUncached(),
  ])
  if (historyResult.error) throw new Error(historyResult.error.message)
  const history = (historyResult.data ?? []) as MemberSuspensionRow[]
  const nowMs = Date.now()
  const active = history.find((row) => isMemberSuspensionActive(row, nowMs)) ?? null

  let deadlines: MemberSuspensionSectionData['deadlines'] = null
  let paidBalance: number | null = null
  if (canSuspend || hasAdminPermission(access, 'credits.view')) {
    try {
      const { data, error } = await db().rpc('member_refund_deadlines', { p_user_id: userId })
      if (error) throw new Error(error.message)
      const parsed = parseMemberRefundDeadlines(data)
      if (!parsed) throw new Error('member_refund_deadlines 결과 모양이 다릅니다.')
      if (canSuspend) {
        deadlines = { failed: false, data: { earliestCreditExpiry: parsed.earliestCreditExpiry, chargeRefundUntil: parsed.chargeRefundUntil, materialRefundUntil: parsed.materialRefundUntil } }
      }
      if (hasAdminPermission(access, 'credits.view')) paidBalance = parsed.paidBalance
    } catch (error) {
      console.error('[admin-member-suspension] 환불·소멸 기한을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
      if (canSuspend) deadlines = { failed: true }
    }
  }

  let pending: MemberSuspensionSectionData['pending'] = null
  if (hasAdminPermission(access, 'orders.view')) {
    try {
      pending = { failed: false, data: await readPendingCounts(userId) }
    } catch (error) {
      console.error('[admin-member-suspension] 대기 건수를 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
      pending = { failed: true }
    }
  }

  const actorLabels = await readActorLabels(history.flatMap((row) => [row.created_by, row.lifted_by ?? '']))
  return { withdrawn: false, history, active, policy, actorLabels, deadlines, paidBalance, pending, databaseNow }
}

export interface MemberNotesSectionData {
  withdrawn: boolean
  notes: MemberAdminNoteRow[]
  authorLabels: Record<string, string>
  memoGuide: string | null
  truncated: boolean
}

// '관리자 메모' 구역(members.view). 최신 순. 탈퇴 회원은 메모가 익명화로 지워졌으므로 읽지 않는다.
export async function readMemberNotesSection(userId: string, withdrawnAt: string | null): Promise<MemberNotesSectionData> {
  if (withdrawnAt) return { withdrawn: true, notes: [], authorLabels: {}, memoGuide: null, truncated: false }
  const [notesResult, policy] = await Promise.all([
    db().from('member_admin_notes').select(NOTE_COLUMNS).eq('user_id', userId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(NOTE_LIMIT + 1),
    readMemberSuspensionPolicyUncached(),
  ])
  if (notesResult.error) throw new Error(notesResult.error.message)
  const rows = (notesResult.data ?? []) as MemberAdminNoteRow[]
  const notes = rows.slice(0, NOTE_LIMIT)
  const authorLabels = await readActorLabels(notes.flatMap((note) => [note.created_by, note.deleted_by ?? '', note.redacted_by ?? '']))
  return { withdrawn: false, notes, authorLabels, memoGuide: policy?.texts.adminMemoGuide ?? null, truncated: rows.length > NOTE_LIMIT }
}

// ── API route 가 쓰는 호출 ─────────────────────────────────────────────────────────────────────────────
export type MemberSuspensionCallResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string }

// 대상 기록이 주소의 회원 것인지 RPC 전에 본다(다른 회원 기록을 이 회원 맥락으로 처리하지 않게).
export async function readMemberRecordOwner(table: 'member_suspensions' | 'member_admin_notes', id: string): Promise<{ ok: true; userId: string | null } | { ok: false }> {
  const { data, error } = await db().from(table).select('user_id').eq('id', id).maybeSingle()
  if (error) {
    console.error('[admin-member-suspension] 대상 기록을 읽지 못했습니다.', { table, message: error.message })
    return { ok: false }
  }
  return { ok: true, userId: data?.user_id ?? null }
}

export async function callMemberSuspensionRpc<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<MemberSuspensionCallResult<T>> {
  const { data, error } = await db().rpc(name, args)
  if (error) {
    const view = describeMemberSuspensionError(error.message)
    if (view.code === 'MEMBER_SUSPENSION_UNKNOWN_ERROR') {
      console.error('[admin-member-suspension] DB 함수 실패', { name, message: error.message })
    }
    return { ok: false, status: view.status, code: view.code, message: view.message }
  }
  return { ok: true, data: (data ?? {}) as T }
}
