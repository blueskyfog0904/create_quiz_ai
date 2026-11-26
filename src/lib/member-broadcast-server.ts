import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import {
  extractMemberNotificationError,
  type BroadcastRetractReasonCode,
  type BroadcastTarget,
  type MemberNotificationErrorCode,
  type MemberNotificationTexts,
} from '@/lib/member-notifications'
import type { AdminRequestMeta } from '@/lib/admin-request-meta'

// 16번 7절: 관리자 '알림' 화면의 서버 읽기(서버 키, 캐시 없음)와 DB 함수 호출. 기록 표는 service_role SELECT 만 있다.
// 읽기 실패는 페이지에 던지지 않고 'unavailable' 로 돌려준다(화면이 '확인하지 못했습니다'로 알린다).
// notifications.broadcast_id 는 16번 DB 적용 뒤에만 있다 — 읽은 수 조회가 실패하면 읽은 수를 null 로 둔다.

const db = () => createAdminClient() as unknown as SupabaseClient

export interface MemberBroadcastHistoryItem {
  id: string
  createdAt: string
  actorLabel: string
  target: BroadcastTarget
  recipientCount: number
  title: string
  message: string
  linkUrl: string | null
  postId: string | null
  statementVersion: number
  readCount: number | null
  retractedAt: string | null
  retractReasonCode: BroadcastRetractReasonCode | null
  retractedDeletedCount: number | null
  retractedReadCount: number | null
  redactedAt: string | null
}

interface BroadcastRow {
  id: string
  created_at: string
  actor_id: string
  target: BroadcastTarget
  recipient_count: number
  title: string
  message: string
  link_url: string | null
  post_id: string | null
  not_advertising_statement_version: number
  retracted_at: string | null
  retract_reason_code: BroadcastRetractReasonCode | null
  retracted_deleted_count: number | null
  retracted_read_count: number | null
  redacted_at: string | null
}

const HISTORY_LIMIT = 100

async function actorLabels(ids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (ids.length === 0) return labels
  const { data } = await db().from('profiles').select('id, email').in('id', ids)
  for (const profile of (data ?? []) as { id: string; email: string | null }[]) {
    if (profile.email) labels.set(profile.id, profile.email)
  }
  return labels
}

// 보낸 기록(최신순 100건). 읽은 수는 회수 전 기록만 지금 알림 행에서 센다(회수한 기록은 회수 때 센 값).
export async function readMemberBroadcastHistory(): Promise<{ status: 'ok'; items: MemberBroadcastHistoryItem[] } | { status: 'unavailable' }> {
  try {
    const { data, error } = await db()
      .from('member_notification_broadcasts')
      .select('id, created_at, actor_id, target, recipient_count, title, message, link_url, post_id, not_advertising_statement_version, retracted_at, retract_reason_code, retracted_deleted_count, retracted_read_count, redacted_at')
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (error) return { status: 'unavailable' }
    const rows = (data ?? []) as BroadcastRow[]
    const labels = await actorLabels([...new Set(rows.map((row) => row.actor_id))])
    // 회수 전 기록의 읽은 알림을 한 번에(500행씩 나눠) 읽어 코드에서 센다. 읽지 못하면 그 기록들의 읽은 수는 null.
    const readCounts = new Map<string, number | null>()
    const openIds = rows.filter((row) => !row.retracted_at).map((row) => row.id)
    if (openIds.length > 0) {
      try {
        const readRows = await readAllQueryRows<{ id: string; broadcast_id: string }>((from, to) => db()
          .from('notifications')
          .select('id, broadcast_id')
          .in('broadcast_id', openIds)
          .eq('is_read', true)
          .order('id')
          .range(from, to))
        for (const id of openIds) readCounts.set(id, 0)
        for (const row of readRows) readCounts.set(row.broadcast_id, (readCounts.get(row.broadcast_id) ?? 0) + 1)
      } catch {
        for (const id of openIds) readCounts.set(id, null)
      }
    }
    return {
      status: 'ok',
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        actorLabel: labels.get(row.actor_id) ?? row.actor_id.slice(0, 8),
        target: row.target,
        recipientCount: row.recipient_count,
        title: row.title,
        message: row.message,
        linkUrl: row.link_url,
        postId: row.post_id,
        statementVersion: row.not_advertising_statement_version,
        readCount: row.retracted_at ? row.retracted_read_count : readCounts.get(row.id) ?? null,
        retractedAt: row.retracted_at,
        retractReasonCode: row.retract_reason_code,
        retractedDeletedCount: row.retracted_deleted_count,
        retractedReadCount: row.retracted_read_count,
        redactedAt: row.redacted_at,
      })),
    }
  } catch {
    return { status: 'unavailable' }
  }
}

export interface BroadcastNoticeOption {
  id: string
  title: string
}

// 연결할 수 있는 공지: 게시 중인 공지 글(14번 표). 읽지 못하면 빈 목록(연결은 고정 경로만).
export async function readPublishedNoticeOptions(): Promise<BroadcastNoticeOption[]> {
  try {
    const { data, error } = await db()
      .from('site_board_posts')
      .select('id, title')
      .eq('board', 'notice')
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('published_at', { ascending: false })
      .limit(200)
    if (error) return []
    return ((data ?? []) as { id: string; title: string }[]).map((row) => ({ id: row.id, title: row.title }))
  } catch {
    return []
  }
}

export interface BroadcastTermsOption {
  slug: string
  label: string
}

// 연결할 수 있는 약관 문서: 하단 정보에 켜져 있고 본문이 있는 문서(DB send_member_broadcast 와 같은 조건).
export async function readBroadcastTermsOptions(): Promise<BroadcastTermsOption[]> {
  try {
    const { data } = await db().from('system_settings').select('value').eq('key', 'site_footer_content').maybeSingle()
    const documents = (data?.value as { policyDocuments?: Record<string, { slug?: unknown; label?: unknown; enabled?: unknown; content?: unknown }> } | null)?.policyDocuments
    if (!documents || typeof documents !== 'object') return []
    return Object.values(documents)
      .filter((doc) => doc && doc.enabled === true && typeof doc.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,49}$/.test(doc.slug)
        && typeof doc.content === 'string' && doc.content.trim() !== '')
      .map((doc) => ({ slug: doc.slug as string, label: typeof doc.label === 'string' && doc.label.trim() ? doc.label.trim() : (doc.slug as string) }))
  } catch {
    return []
  }
}

// 14번 숨김·삭제·가림 확인 창: 글마다 회수하지 않은 공지 알림 수. 읽지 못하면 null(확인 못 함).
export async function readLinkedBroadcastCounts(postIds: string[]): Promise<Record<string, number> | null> {
  if (postIds.length === 0) return {}
  try {
    const { data, error } = await db()
      .from('member_notification_broadcasts')
      .select('post_id')
      .in('post_id', postIds)
      .is('retracted_at', null)
    if (error) return null
    const counts: Record<string, number> = {}
    for (const row of (data ?? []) as { post_id: string | null }[]) {
      if (row.post_id) counts[row.post_id] = (counts[row.post_id] ?? 0) + 1
    }
    return counts
  } catch {
    return null
  }
}

// ── DB 함수 호출(서버 액션만 부른다) ─────────────────────────────────────────────────────────────────
export type MemberNotificationCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: MemberNotificationErrorCode; detail: string | null } | null }

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<MemberNotificationCallResult<T>> {
  try {
    const { data, error } = await db().rpc(name, args)
    if (error) {
      const parsed = extractMemberNotificationError(error.message)
      if (!parsed) console.error(`[member-broadcast] ${name} 실패`, error.code ?? error.message)
      return { ok: false, error: parsed }
    }
    return { ok: true, data: (data ?? {}) as T }
  } catch {
    console.error(`[member-broadcast] ${name} 실패`, 'exception')
    return { ok: false, error: null }
  }
}

export interface MemberBroadcastPreview {
  target: BroadcastTarget
  recipientCount: number
  dailyLimit: number
  usedInWindow: number
  remaining: number
  nextAvailableAt: string | null
  notAdvertisingStatementVersion: number
}

export function callSaveMemberNotificationTexts(actorId: string, expectedRevision: number, value: MemberNotificationTexts, requestMeta: AdminRequestMeta) {
  return callRpc<{ changed?: boolean; revision?: number; statementVersion?: number }>('save_member_notification_texts', {
    p_actor_id: actorId,
    p_expected_revision: expectedRevision,
    p_value: value,
    p_request_meta: requestMeta,
  })
}

export function callMemberBroadcastPreview(actorId: string, target: BroadcastTarget) {
  return callRpc<MemberBroadcastPreview>('member_broadcast_preview', { p_actor_id: actorId, p_target: target })
}

export interface SendMemberBroadcastInput {
  operationKey: string
  target: BroadcastTarget
  title: string
  message: string
  linkUrl: string | null
  postId: string | null
  expectedCount: number
  notAdvertisingVersion: number
}

export function callSendMemberBroadcast(actorId: string, input: SendMemberBroadcastInput, requestMeta: AdminRequestMeta) {
  return callRpc<{ broadcast_id?: string; recipient_count?: number; replayed?: boolean }>('send_member_broadcast', {
    p_actor_id: actorId,
    p_operation_key: input.operationKey,
    p_target: input.target,
    p_title: input.title,
    p_message: input.message,
    p_link_url: input.linkUrl,
    p_post_id: input.postId,
    p_expected_count: input.expectedCount,
    p_not_advertising_version: input.notAdvertisingVersion,
    p_request_meta: requestMeta,
  })
}

export function callRetractMemberBroadcast(actorId: string, broadcastId: string, reasonCode: BroadcastRetractReasonCode, redact: boolean, requestMeta: AdminRequestMeta) {
  return callRpc<{ changed?: boolean; retracted?: boolean; redacted?: boolean; deleted_count?: number | null; read_count?: number | null }>('retract_member_broadcast', {
    p_actor_id: actorId,
    p_broadcast_id: broadcastId,
    p_reason_code: reasonCode,
    p_redact: redact,
    p_request_meta: requestMeta,
  })
}
