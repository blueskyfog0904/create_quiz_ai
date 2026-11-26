import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { isAdminMemberAccessScreen, type AdminMemberAccessScreen } from '@/lib/admin-member-access-log'
import { getKstDateStart } from '@/lib/kst-period'
import { getListPagination } from '@/lib/list-pagination'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { Json } from '@/types/supabase'

// 13번 8-3: 대표 조회 화면('개인정보 열람' 탭). 표 admin_member_access_log 는 service role 만 읽는다(추가 전용).
// 이메일은 다시 펼치지 않는다: 회원은 표시 이름(이메일 앞 4글자 + 태그)과 회원 상세 링크만 보인다.

const db = () => createAdminClient() as unknown as SupabaseClient
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 줄마다 이름을 보이는 회원 수(나머지는 '외 N명')
export const ACCESS_LOG_NAMED_MEMBERS = 3

export interface AdminMemberAccessLogRow {
  id: string
  createdAt: string
  actorId: string
  actor: string | null
  screen: string
  memberCount: number
  members: Array<{ id: string; name: string | null; withdrawn: boolean }>
  fields: string[]
  reason: string | null
  ipPrefix: string | null
  context: Json
}

export interface AdminMemberAccessLogResult {
  rows: AdminMemberAccessLogRow[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  actors: Array<{ id: string; loginId: string }>
  // 회원 필터로 들어왔을 때 그 회원의 표시 이름
  member: { id: string; name: string | null } | null
}

// IP 앞부분만 보인다(IPv4 는 앞 두 자리, IPv6 는 앞 두 묶음).
export function accessLogIpPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null
  const value = ip.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return `${value.split('.').slice(0, 2).join('.')}.*.*`
  if (value.includes(':')) return `${value.split(':').slice(0, 2).join(':')}:…`
  return value.slice(0, 8)
}

interface AccessLogDbRow {
  id: string
  created_at: string
  actor_id: string
  screen: string
  member_ids: string[]
  fields: string[]
  context: Json
  reason: string | null
  ip: string | null
}

export async function listAdminMemberAccessLog(input: {
  actor?: string | null
  screen?: string | null
  member?: string | null
  from?: string | null
  to?: string | null
  page?: unknown
  pageSize?: unknown
}): Promise<AdminMemberAccessLogResult> {
  const actor = input.actor && UUID_PATTERN.test(input.actor) ? input.actor : null
  const member = input.member && UUID_PATTERN.test(input.member) ? input.member : null
  const screen: AdminMemberAccessScreen | null = input.screen && isAdminMemberAccessScreen(input.screen) ? input.screen : null
  // 기간은 한국 날짜 기준(작업 기록 탭과 같다). 시작과 종료가 뒤바뀌어 들어오면 바로잡는다.
  const [fromDate, toDate] = input.from && input.to && input.from > input.to ? [input.to, input.from] : [input.from, input.to]
  const createdFrom = getKstDateStart(fromDate)
  const createdBefore = getKstDateStart(toDate, 1)

  const filtered = (head: boolean) => {
    let query = db().from('admin_member_access_log')
      .select(head ? 'id' : 'id, created_at, actor_id, screen, member_ids, fields, context, reason, ip', head ? { count: 'exact', head: true } : undefined)
    if (actor) query = query.eq('actor_id', actor)
    if (screen) query = query.eq('screen', screen)
    if (member) query = query.contains('member_ids', [member])
    if (createdFrom) query = query.gte('created_at', createdFrom)
    if (createdBefore) query = query.lt('created_at', createdBefore)
    return query
  }

  // 처리자 필터 선택지: 지금 관리자 계정(관리자끼리 — 열람 기록 대상 아님)
  const [countResult, adminsResult] = await Promise.all([
    filtered(true),
    db().from('profiles').select('id, email').eq('is_admin', true),
  ])
  if (countResult.error) throw new Error(countResult.error.message)
  if (adminsResult.error) throw new Error(adminsResult.error.message)
  const admins = (adminsResult.data ?? []) as Array<{ id: string; email: string | null }>
  const loginIdById = new Map(admins.map((admin) => [admin.id, admin.email ? extractAdminLoginId(admin.email) : admin.id]))
  const actors = [...loginIdById.entries()].map(([id, loginId]) => ({ id, loginId })).sort((a, b) => a.loginId.localeCompare(b.loginId))

  const pagination = getListPagination(countResult.count ?? 0, input.page, input.pageSize)
  const base = { totalCount: pagination.totalCount, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, actors }

  let rows: AccessLogDbRow[] = []
  if (pagination.totalCount > 0) {
    const { data, error } = await filtered(false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
    if (error) throw new Error(error.message)
    rows = (data ?? []) as unknown as AccessLogDbRow[]
  }

  // 표시 이름: 줄마다 앞 3명과 회원 필터의 회원만 읽는다(이메일은 이름을 만드는 데만 쓰고 내보내지 않는다).
  const namedIds = [...new Set([
    ...rows.flatMap((row) => row.member_ids.slice(0, ACCESS_LOG_NAMED_MEMBERS)),
    ...(member ? [member] : []),
  ])]
  const names = new Map<string, { name: string | null; withdrawn: boolean }>()
  if (namedIds.length > 0) {
    const { data, error } = await db().from('profiles').select('id, email, display_tag, withdrawn_at').in('id', namedIds)
    if (error) throw new Error(error.message)
    for (const profile of (data ?? []) as Array<{ id: string; email: string | null; display_tag: string | null; withdrawn_at: string | null }>) {
      names.set(profile.id, profile.withdrawn_at
        ? { name: null, withdrawn: true }
        : { name: formatMemberDisplayName(profile.email, profile.display_tag), withdrawn: false })
    }
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorId: row.actor_id,
      actor: loginIdById.get(row.actor_id) ?? null,
      screen: row.screen,
      memberCount: row.member_ids.length,
      members: row.member_ids.slice(0, ACCESS_LOG_NAMED_MEMBERS).map((id) => ({ id, name: names.get(id)?.name ?? null, withdrawn: names.get(id)?.withdrawn ?? false })),
      fields: row.fields,
      reason: row.reason,
      ipPrefix: accessLogIpPrefix(row.ip),
      context: row.context ?? {},
    })),
    ...base,
    member: member ? { id: member, name: names.get(member)?.name ?? null } : null,
  }
}

// 이 화면이 보인 회원(표시 이름을 실은 회원 — 기록 대상). 관리자 계정은 뺀다.
export function shownAccessLogMemberIds(result: AdminMemberAccessLogResult): string[] {
  const adminIds = new Set(result.actors.map((actor) => actor.id))
  return [
    ...result.rows.flatMap((row) => row.members.filter((member) => member.name).map((member) => member.id)),
    ...(result.member?.name ? [result.member.id] : []),
  ].filter((id) => !adminIds.has(id))
}
