import 'server-only'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getMemberSuspensionPolicyCached } from '@/lib/member-suspension-policy-server'
import {
  MEMBER_RESTRICTION_CHECK_FAILED_PATH,
  MEMBER_RESTRICTION_HEADER,
  MEMBER_RESTRICTION_HEADER_VALUE,
  MEMBER_RESTRICTION_PAGE_PATH,
  MEMBER_SUSPENSION_FALLBACK_TEXTS,
  parseMemberRefundDeadlines,
  type MemberRefundDeadlines,
  type MemberSuspensionBlockCode,
  type MemberSuspensionScope,
} from '@/lib/member-suspension'

// 12번 5-1: 이용 제한의 실제 강제(서버 공용 가드). 인증 확인 직후, 첫 DB 쓰기·외부 호출 전에 부른다.
// 읽기에 실패하면 막는다(503). 화면 안내(미들웨어)는 최선 노력이고 여기가 마지막 관문이다.
// 'write'(구매·충전·담기·후기 쓰기·추천)는 정지 중이면 늘 막고, 'download' 는 정지할 때 '다운로드도 막기'를 고른 경우만 막는다.
// 로그인 차단 회원은 세션이 지워져 여기까지 오지 못한다(오면 같은 규칙으로 막힘 — 로그인 차단은 blocksDownload 가 늘 true).
export type MemberSuspensionAction = 'write' | 'download'

export type MemberSuspensionBlock = { status: 403 | 503; code: MemberSuspensionBlockCode; message: string }

async function apiBlockedMessage() {
  const policy = await getMemberSuspensionPolicyCached()
  return policy?.texts.apiBlocked ?? MEMBER_SUSPENSION_FALLBACK_TEXTS.apiBlocked
}

export async function checkMemberSuspensionForApi(userId: string, action: MemberSuspensionAction): Promise<MemberSuspensionBlock | null> {
  try {
    const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
      .rpc('member_active_suspension', { p_user_id: userId })
    if (error) {
      console.error('[MemberSuspension] member_active_suspension failed', { code: error.code })
      return { status: 503, code: 'SUSPENSION_CHECK_FAILED', message: MEMBER_SUSPENSION_FALLBACK_TEXTS.noticeCheckFailed }
    }
    if (data === null || data === undefined) return null
    if (typeof data !== 'object' || Array.isArray(data)) {
      return { status: 503, code: 'SUSPENSION_CHECK_FAILED', message: MEMBER_SUSPENSION_FALLBACK_TEXTS.noticeCheckFailed }
    }
    const blocksDownload = (data as { blocksDownload?: unknown }).blocksDownload
    if (action === 'download' && blocksDownload === false) return null
    return { status: 403, code: 'MEMBER_SUSPENDED', message: await apiBlockedMessage() }
  } catch {
    return { status: 503, code: 'SUSPENSION_CHECK_FAILED', message: MEMBER_SUSPENSION_FALLBACK_TEXTS.noticeCheckFailed }
  }
}

// 응답 모양은 API 쪽 관례({ success, error: { code, message } })를 따른다. 화면은 code 로 판단한다(src/lib/member-suspension-client.ts).
export function memberSuspensionBlockResponse(block: MemberSuspensionBlock) {
  return NextResponse.json(
    { success: false, code: block.code, error: { code: block.code, message: block.message } },
    { status: block.status }
  )
}

// 다운로드는 GET 이동이라 날 JSON 대신 안내 화면으로 303 이동한다(확인 실패는 ?check=failed — '잠시 후 다시 시도').
export function memberSuspensionDownloadRedirect(request: Request, block: MemberSuspensionBlock) {
  const path = block.code === 'MEMBER_SUSPENDED' ? MEMBER_RESTRICTION_PAGE_PATH : MEMBER_RESTRICTION_CHECK_FAILED_PATH
  return NextResponse.redirect(new URL(path, request.url), 303)
}

// ── 회원 화면(5-3) ──────────────────────────────────────────────────────────────────────────────
// 10절 4단계 개발 전용 미리보기: 운영 DB 에 쓰지 않고 이용 제한 화면(한 줄 안내·안내 화면)을 본다. 조건 셋은 15번 10-1 과 같다.
export function isMemberRestrictionPreviewEnabled() {
  return process.env.NODE_ENV === 'development'
    && !process.env.VERCEL
    && process.env.MEMBER_RESTRICTION_PREVIEW === '1'
}

// 미들웨어가 이용 제한으로 판정해 붙인 요청 헤더(밖에서 온 값은 미들웨어가 늘 지운다). 미리보기면 늘 true.
export async function isRequestMemberRestricted() {
  if (isMemberRestrictionPreviewEnabled()) return true
  return (await headers()).get(MEMBER_RESTRICTION_HEADER) === MEMBER_RESTRICTION_HEADER_VALUE
}

export interface MemberActiveSuspensionView {
  id: string
  scope: MemberSuspensionScope
  blocksDownload: boolean
  reasonCode: string
  reasonLabel: string
  memberReason: string
  startsAt: string
  endsAt: string | null
  firstSeenAt: string | null
}

function parseActiveSuspension(data: unknown): MemberActiveSuspensionView | null | undefined {
  if (data === null || data === undefined) return null
  if (typeof data !== 'object' || Array.isArray(data)) return undefined
  const row = data as Record<string, unknown>
  if (typeof row.id !== 'string' || (row.scope !== 'restricted' && row.scope !== 'login_blocked') || typeof row.blocksDownload !== 'boolean'
      || typeof row.startsAt !== 'string') return undefined
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    id: row.id,
    scope: row.scope,
    blocksDownload: row.blocksDownload,
    reasonCode: text(row.reasonCode),
    reasonLabel: text(row.reasonLabel),
    memberReason: text(row.memberReason),
    startsAt: row.startsAt,
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : null,
    firstSeenAt: typeof row.firstSeenAt === 'string' ? row.firstSeenAt : null,
  }
}

// 안내 화면 서버 읽기: 활성 정지와 환불·소멸 기한. 읽지 못하면 ok: false(화면은 '확인하지 못했습니다' 문구).
export async function readMemberRestrictionNotice(userId: string): Promise<
  { ok: true; suspension: MemberActiveSuspensionView | null; deadlines: MemberRefundDeadlines | null } | { ok: false }
> {
  try {
    const db = createAdminClient() as unknown as SupabaseClient
    const active = await db.rpc('member_active_suspension', { p_user_id: userId })
    const suspension = active.error ? undefined : parseActiveSuspension(active.data)
    if (suspension === undefined) {
      if (active.error) console.error('[MemberSuspension] member_active_suspension failed', { code: active.error.code })
      return { ok: false }
    }
    if (!suspension) return { ok: true, suspension: null, deadlines: null }
    // 기한은 표시용이다 — 읽지 못해도 안내 화면은 그린다(문구 noticeDeadlines 는 늘 보임).
    const deadlines = await db.rpc('member_refund_deadlines', { p_user_id: userId })
    if (deadlines.error) console.error('[MemberSuspension] member_refund_deadlines failed', { code: deadlines.error.code })
    return { ok: true, suspension, deadlines: deadlines.error ? null : parseMemberRefundDeadlines(deadlines.data) }
  } catch {
    return { ok: false }
  }
}

// 화면 알림의 증빙: 안내 화면을 처음 연 시각(비어 있을 때만 DB 가 채움). 실패해도 화면은 그린다.
export async function markMemberSuspensionSeen(userId: string) {
  try {
    const { error } = await (createAdminClient() as unknown as SupabaseClient).rpc('mark_member_suspension_seen', { p_user_id: userId })
    if (error) console.error('[MemberSuspension] mark_member_suspension_seen failed', { code: error.code })
  } catch {
    // 화면은 그대로 그린다
  }
}
