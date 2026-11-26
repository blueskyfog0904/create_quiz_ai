import 'server-only'

import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminAccess } from '@/lib/admin-permissions'
import {
  ADMIN_MEMBER_ACCESS_SCREENS,
  buildMemberAccessBatches,
  type AdminMemberAccessField,
  type AdminMemberAccessScreen,
} from '@/lib/admin-member-access-log'
import { adminRequestMeta, type AdminRequestMeta } from '@/lib/admin-request-meta'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { Json } from '@/types/supabase'

// 13번 묶음 8절: 관리자 회원 연락처 열람 기록. 기록은 이 파일의 두 함수로만 남긴다(한 곳에서만 부른다).
//   recordMemberAccess   — 서버 키로 이미 연락처를 읽은 화면이 응답을 돌려주기 전에 부른다.
//   attachMemberContacts — 세션으로 읽은 행(탈퇴 가림은 RLS 가 함)에 연락처를 서버 키로 붙이면서 기록한다(8-2).
// 순서: 기록을 먼저 남기고 데이터를 돌려준다. 기록이 실패하면 연락처를 가려서 보이고 대표에게 알린다(Q4 가, 같은 화면은 1시간에 1번).

type UntypedClient = SupabaseClient
const db = () => createAdminClient() as unknown as UntypedClient

export interface MemberAccessInput {
  access: Pick<AdminAccess, 'userId'>
  screen: AdminMemberAccessScreen
  memberIds: readonly (string | null | undefined)[]
  fields: readonly AdminMemberAccessField[]
  // 문의 id·쪽·검색했는지·결과 수 같은 화면 정보. 검색어 원문은 넣지 않는다.
  context?: { [key: string]: Json | undefined }
  reason?: string | null
  // route 는 adminRequestMeta(request) 를 넘긴다. 없으면 지금 요청의 headers() 로 채운다.
  requestMeta?: AdminRequestMeta
}

async function currentRequestMeta(): Promise<AdminRequestMeta> {
  try {
    return adminRequestMeta(await headers())
  } catch {
    return { ip: null, user_agent: null }
  }
}

async function alertMemberAccessLogFailure(screen: AdminMemberAccessScreen) {
  try {
    const hour = new Date().toISOString().slice(0, 13)
    const { error } = await db().from('admin_events').insert({
      kind: 'member_access_log_failed',
      severity: 'warning',
      title: '회원 정보 열람 기록을 남기지 못했습니다',
      body: `${ADMIN_MEMBER_ACCESS_SCREENS[screen]} 화면의 회원 연락처를 가려서 보였습니다. 열람 기록 기능을 확인해 주세요.`,
      link: '/admin/audit-log?tab=access',
      required_permission: 'owner',
      dedupe_key: `member_access_log_failed:${screen}:${hour}`,
    })
    // 23505: 같은 화면으로 이번 시간에 이미 알렸다.
    if (error && error.code !== '23505') {
      console.error('[member-access-log] 기록 실패 알림을 남기지 못했습니다.', { screen, code: error.code })
    }
  } catch (error) {
    console.error('[member-access-log] 기록 실패 알림을 남기지 못했습니다.', { screen, message: error instanceof Error ? error.message : String(error) })
  }
}

// 기록을 남긴다. 회원이 0명이면 부르지 않고 true. 200명을 넘으면 나눠 남긴다(context.part·parts).
// 실패하면 대표에게 알리고 false — 부른 쪽은 연락처를 가려서 돌려준다.
export async function recordMemberAccess(input: MemberAccessInput): Promise<boolean> {
  const batches = buildMemberAccessBatches(input.memberIds)
  if (batches.length === 0) return true
  const requestMeta = input.requestMeta ?? (await currentRequestMeta())
  try {
    for (let index = 0; index < batches.length; index += 1) {
      const context = { ...(input.context ?? {}), ...(batches.length > 1 ? { part: index + 1, parts: batches.length } : {}) }
      const { error } = await db().rpc('record_admin_member_access', {
        p_actor_id: input.access.userId,
        p_screen: input.screen,
        p_member_ids: batches[index],
        p_fields: [...input.fields],
        p_context: context,
        p_reason: input.reason?.trim() ? input.reason.trim() : null,
        p_request_meta: requestMeta,
      })
      if (error) {
        console.error('[member-access-log] 열람 기록을 남기지 못했습니다.', { screen: input.screen, code: error.code, message: error.message })
        await alertMemberAccessLogFailure(input.screen)
        return false
      }
    }
    return true
  } catch (error) {
    console.error('[member-access-log] 열람 기록을 남기지 못했습니다.', { screen: input.screen, message: error instanceof Error ? error.message : String(error) })
    await alertMemberAccessLogFailure(input.screen)
    return false
  }
}

export interface MemberContact {
  id: string
  email: string | null
  phone: string | null
  display_tag: string | null
}

const CONTACT_READ_CHUNK = 200

// 서버 키로 연락처를 읽는다. 탈퇴 회원(withdrawn_at 있음)은 돌려주지 않는다. 읽지 못하면 예외.
export async function readMemberContacts(userIds: readonly string[]): Promise<Map<string, MemberContact>> {
  const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0))]
  const contacts = new Map<string, MemberContact>()
  for (let index = 0; index < ids.length; index += CONTACT_READ_CHUNK) {
    const { data, error } = await db()
      .from('profiles')
      .select('id, email, phone, display_tag, withdrawn_at')
      .in('id', ids.slice(index, index + CONTACT_READ_CHUNK))
    if (error) throw new Error(`회원 연락처 조회 실패: ${error.code ?? ''}`)
    for (const row of (data ?? []) as Array<MemberContact & { withdrawn_at: string | null }>) {
      if (row.withdrawn_at) continue
      contacts.set(row.id, { id: row.id, email: row.email ?? null, phone: row.phone ?? null, display_tag: row.display_tag ?? null })
    }
  }
  return contacts
}

export interface AttachMemberContactsInput<Row, Out> extends Omit<MemberAccessInput, 'memberIds' | 'fields'> {
  rows: readonly Row[]
  userIdOf: (row: Row) => string | null | undefined
  // 화면에 보이는 연락처만 적는다(기록의 fields 와 같음). 적지 않은 칸은 null 로 넘긴다.
  fields: readonly ('email' | 'phone')[]
  // 지금 화면이 받는 모양대로 채운다(문의 profiles: { email, phone }, 환불 user: { email, display_tag }). 가린 경우 contact 는 null.
  shape: (row: Row, contact: MemberContact | null) => Out
}

// 세션으로 읽은 행에 연락처를 붙인다(8-2). 탈퇴 회원은 붙이지 않고 기록 member_ids 에서도 뺀다(읽는 사이 탈퇴한 경합 대비).
// 기록에 실패하면 모든 행을 연락처 없이(null) 돌려준다(Q4 가). 연락처를 읽지 못하면 예외.
export async function attachMemberContacts<Row, Out>(input: AttachMemberContactsInput<Row, Out>): Promise<{ rows: Out[]; logged: boolean }> {
  const userIds = input.rows.map(input.userIdOf).filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (userIds.length === 0) return { rows: input.rows.map((row) => input.shape(row, null)), logged: true }
  const contacts = await readMemberContacts(userIds)
  const logged = await recordMemberAccess({
    access: input.access,
    screen: input.screen,
    memberIds: [...contacts.keys()],
    fields: input.fields,
    context: input.context,
    reason: input.reason,
    requestMeta: input.requestMeta,
  })
  const showEmail = input.fields.includes('email')
  const showPhone = input.fields.includes('phone')
  return {
    logged,
    rows: input.rows.map((row) => {
      const userId = input.userIdOf(row)
      const contact = logged && userId ? contacts.get(userId) ?? null : null
      return input.shape(row, contact ? { ...contact, email: showEmail ? contact.email : null, phone: showPhone ? contact.phone : null } : null)
    }),
  }
}
