import 'server-only'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_SOURCE_LABELS, type AdminAuditAction } from '@/lib/admin-audit-log'
import { PAYMENT_ADMIN_ACTION_LABELS, normalizeOrderFilter } from '@/lib/admin-orders'
import { getKstDateStart } from '@/lib/kst-period'
import { getListPagination } from '@/lib/list-pagination'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { Database, Json } from '@/types/supabase'

// 관리자 작업 기록(계획 U3-5). 표 admin_audit_log는 service role만 쓰고 읽는다(마이그레이션 20261117110000).

export interface AdminAuditEntry {
  actorId: string
  action: AdminAuditAction
  targetType?: string | null
  targetId?: string | null
  // 대상 회원(조회 화면이 회원 상세로 잇는다)
  targetUserId?: string | null
  // 크레딧 수량(지급·환불). 하루 지급 한도 합산(U3-6)이 이 값을 쓴다.
  amount?: number | null
  reason?: string | null
  details?: { [key: string]: Json | undefined }
}

// 본 동작이 성공한 뒤에 부른다. 기록이 실패해도 던지지 않고 false만 돌려준다(본 동작의 응답은 그대로 둔다).
// 표가 아직 없을 때(마이그레이션 적용 전 배포)도 같은 길로 false가 된다.
export async function recordAdminAudit(entry: AdminAuditEntry): Promise<boolean> {
  try {
    // 생성된 타입은 함수 인자를 모두 값 있는 것으로 적지만, 빈 칸은 null로 보내야 한다(SQL 함수가 NULL을 받는다).
    const args = {
      p_actor_id: entry.actorId,
      p_action: entry.action,
      p_target_type: entry.targetType ?? null,
      p_target_id: entry.targetId ?? null,
      p_target_user_id: entry.targetUserId ?? null,
      p_amount: entry.amount ?? null,
      p_reason: entry.reason ?? null,
      p_details: entry.details ?? {},
      p_request_id: null,
    } as unknown as Database['public']['Functions']['record_admin_audit']['Args']
    const { error } = await createAdminClient().rpc('record_admin_audit', args)
    if (error) {
      console.error('[admin-audit] 작업 기록을 남기지 못했습니다.', { action: entry.action, code: error.code, message: error.message })
      return false
    }
    return true
  } catch (error) {
    console.error('[admin-audit] 작업 기록을 남기지 못했습니다.', { action: entry.action, message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

// 돈이 움직인 일(마켓 환불)의 기록이 실패했을 때 대표에게 알린다(관리자 알림 → 화면·슬랙). 이것도 실패하면 로그만 남긴다.
// dedupeId: 같은 건의 중복 알림을 막는 열쇠(없으면 refId). 한 회원에게 여러 번 지급하는 것처럼 refId가 겹치는 일은 따로 준다.
export async function alertAdminAuditFailure(input: { action: AdminAuditAction; refTable: string; refId: string; link: string; dedupeId?: string }) {
  try {
    const { error } = await createAdminClient().from('admin_events').insert({
      kind: 'admin_audit_failed',
      severity: 'warning',
      title: '관리자 작업 기록을 남기지 못했습니다',
      body: `${ADMIN_AUDIT_ACTIONS[input.action]} 처리는 완료됐지만 작업 기록이 빠졌습니다. 처리 내역을 확인해 주세요.`,
      link: input.link,
      ref_table: input.refTable,
      ref_id: input.refId,
      required_permission: 'owner',
      dedupe_key: `audit_failed:${input.action}:${input.dedupeId ?? input.refId}`,
    })
    // 23505: 같은 건으로 이미 알림을 남겼다.
    if (error && error.code !== '23505') {
      console.error('[admin-audit] 기록 실패 알림을 남기지 못했습니다.', { action: input.action, code: error.code, message: error.message })
    }
  } catch (error) {
    console.error('[admin-audit] 기록 실패 알림을 남기지 못했습니다.', { action: input.action, message: error instanceof Error ? error.message : String(error) })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 조회 화면(/admin/audit-log). 보기 admin_audit_timeline이 이 기록과 결제 쪽 조치 기록을 같은 모양으로 이어 붙인다.
// ---------------------------------------------------------------------------------------------------------------

// 종류 필터에 쓸 수 있는 값: 이 기록의 종류 + 결제 쪽 조치 종류
export const ADMIN_AUDIT_FILTER_ACTION_LABELS: Record<string, string> = { ...ADMIN_AUDIT_ACTIONS, ...PAYMENT_ADMIN_ACTION_LABELS }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AdminAuditTimelineRow {
  source: string
  id: string
  createdAt: string
  actorId: string
  // 처리자(관리자 아이디 또는 이메일). 찾지 못하면 null
  actor: string | null
  action: string
  targetType: string | null
  targetId: string | null
  targetUserId: string | null
  targetUserEmail: string | null
  amount: number | null
  reason: string | null
  details: Json
}

export interface AdminAuditTimelineResult {
  rows: AdminAuditTimelineRow[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  // 처리자 필터의 선택지(지금 관리자 계정)
  actors: Array<{ id: string; loginId: string }>
}

export async function listAdminAuditTimeline(input: {
  actor?: string | null
  action?: unknown
  source?: unknown
  from?: string | null
  to?: string | null
  page?: unknown
  pageSize?: unknown
}): Promise<AdminAuditTimelineResult> {
  const supabase = createAdminClient()
  const actor = input.actor && UUID_PATTERN.test(input.actor) ? input.actor : null
  const action = normalizeOrderFilter(ADMIN_AUDIT_FILTER_ACTION_LABELS, input.action)
  const source = normalizeOrderFilter(ADMIN_AUDIT_SOURCE_LABELS, input.source)
  // 기간은 한국 날짜 기준(주문 조회와 같다). 시작과 종료가 뒤바뀌어 들어오면 바로잡는다.
  const [fromDate, toDate] = input.from && input.to && input.from > input.to ? [input.to, input.from] : [input.from, input.to]
  const createdFrom = getKstDateStart(fromDate)
  const createdBefore = getKstDateStart(toDate, 1)

  let countQuery = supabase.from('admin_audit_timeline').select('id', { count: 'exact', head: true })
  let dataQuery = supabase.from('admin_audit_timeline').select('*')
  if (actor) {
    countQuery = countQuery.eq('actor_id', actor)
    dataQuery = dataQuery.eq('actor_id', actor)
  }
  if (action !== 'all') {
    countQuery = countQuery.eq('action', action)
    dataQuery = dataQuery.eq('action', action)
  }
  if (source !== 'all') {
    countQuery = countQuery.eq('source', source)
    dataQuery = dataQuery.eq('source', source)
  }
  if (createdFrom) {
    countQuery = countQuery.gte('created_at', createdFrom)
    dataQuery = dataQuery.gte('created_at', createdFrom)
  }
  if (createdBefore) {
    countQuery = countQuery.lt('created_at', createdBefore)
    dataQuery = dataQuery.lt('created_at', createdBefore)
  }

  const [countResult, adminsResult] = await Promise.all([
    countQuery,
    supabase.from('profiles').select('id, email').eq('is_admin', true),
  ])
  if (countResult.error) throw new Error(countResult.error.message)
  if (adminsResult.error) throw new Error(adminsResult.error.message)
  const actors = (adminsResult.data ?? [])
    .map((admin) => ({ id: admin.id, loginId: admin.email ? extractAdminLoginId(admin.email) : admin.id }))
    .sort((a, b) => a.loginId.localeCompare(b.loginId))

  const pagination = getListPagination(countResult.count ?? 0, input.page, input.pageSize)
  const base = { totalCount: pagination.totalCount, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, actors }
  if (pagination.totalCount === 0) return { rows: [], ...base }

  const { data, error } = await dataQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
  if (error) throw new Error(error.message)
  const rows = data ?? []

  // 결제 쪽 행은 이메일 스냅샷이 없어 지금 계정에서 찾는다. 대상 회원 이메일도 함께 읽는다.
  const profileIds = Array.from(new Set(rows.flatMap((row) => [
    ...(row.actor_email ? [] : [row.actor_id]),
    ...(row.target_user_id ? [row.target_user_id] : []),
  ]).filter((id): id is string => Boolean(id))))
  const profilesResult = profileIds.length > 0
    ? await supabase.from('profiles').select('id, email').in('id', profileIds)
    : { data: [], error: null }
  if (profilesResult.error) console.error('[admin-audit] 처리자·대상 회원을 읽지 못했습니다.', { message: profilesResult.error.message })
  const emailById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.email]))

  return {
    rows: rows.map((row) => {
      const actorEmail = row.actor_email ?? (row.actor_id ? emailById.get(row.actor_id) ?? null : null)
      return {
        source: row.source ?? 'admin',
        id: row.id ?? '',
        createdAt: row.created_at ?? '',
        actorId: row.actor_id ?? '',
        actor: actorEmail ? extractAdminLoginId(actorEmail) : null,
        action: row.action ?? '',
        targetType: row.target_type,
        targetId: row.target_id,
        targetUserId: row.target_user_id,
        targetUserEmail: row.target_user_id ? emailById.get(row.target_user_id) ?? null : null,
        amount: row.amount,
        reason: row.reason,
        details: row.details ?? {},
      }
    }),
    ...base,
  }
}
