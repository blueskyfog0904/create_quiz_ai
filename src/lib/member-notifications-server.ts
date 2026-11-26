import 'server-only'

import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  isMemberNotificationEnabled,
  MEMBER_NOTIFICATION_TEXTS_CACHE_SECONDS,
  MEMBER_NOTIFICATION_TEXTS_CACHE_TAG,
  MEMBER_NOTIFICATION_TEXTS_SETTING_KEY,
  parseMemberNotificationTexts,
  renderMemberNotification,
  type MemberNotificationKind,
  type MemberNotificationRenderInput,
  type MemberNotificationTexts,
} from '@/lib/member-notifications'

// 16번 묶음 6절: 회원 알림 보내기 공용 함수. **회원 알림 INSERT 는 이 파일에서만 한다**(계약 시험).
// 알림은 부가 동작이다: 돈이 움직인 뒤에 부르고, 예외를 던지지 않으며, 결과가 응답·재시도 판단을 바꾸지 않는다.
// 문구가 없거나 깨지면 코드 기본 문구로 대신 보내지 않는다(하드코딩 금지) — sent: false 로 돌려주고 관리자 화면이 알린다.

export type MemberNotificationSendResult =
  | { sent: true }
  | { sent: false; reason: 'disabled' | 'texts_unavailable' | 'render_failed' | 'insert_failed' }

export interface MemberNotificationRequest extends MemberNotificationRenderInput {
  kind: MemberNotificationKind
  userId: string
}

const db = () => createAdminClient() as unknown as SupabaseClient

async function readTextsRow(): Promise<MemberNotificationTexts> {
  const { data, error } = await db().from('system_settings').select('value').eq('key', MEMBER_NOTIFICATION_TEXTS_SETTING_KEY).maybeSingle()
  if (error) throw new Error(`member_notification_texts 읽기 실패: ${error.code ?? ''}`)
  const texts = parseMemberNotificationTexts((data as { value?: unknown } | null)?.value ?? null)
  if (!texts) throw new Error('member_notification_texts 가 없거나 형식이 맞지 않습니다.')
  return texts
}

// unstable_cache 는 예외를 캐시하지 않는다(실패는 다음 요청이 다시 읽는다).
const readCachedTexts = unstable_cache(readTextsRow, [MEMBER_NOTIFICATION_TEXTS_SETTING_KEY], {
  revalidate: MEMBER_NOTIFICATION_TEXTS_CACHE_SECONDS,
  tags: [MEMBER_NOTIFICATION_TEXTS_CACHE_TAG],
})

// 회원 화면(벨 머리표)·보내기가 쓴다. 읽지 못하면 null.
export async function getMemberNotificationTexts(): Promise<MemberNotificationTexts | null> {
  try {
    return await readCachedTexts()
  } catch (error) {
    console.error('[member-notifications] 문구를 읽지 못했습니다.', error instanceof Error ? error.message : 'unknown')
    return null
  }
}

// 관리자 화면용: 캐시 없이 읽는다(없음·형식 어긋남·읽기 실패를 구분 — 실패를 빈 양식으로 보이면 덮어쓸 수 있다).
export async function readMemberNotificationTextsForAdmin(): Promise<{ status: 'ok'; texts: MemberNotificationTexts; updatedAt: string | null } | { status: 'missing' | 'invalid' | 'error' }> {
  try {
    const { data, error } = await db().from('system_settings').select('value, updated_at').eq('key', MEMBER_NOTIFICATION_TEXTS_SETTING_KEY).maybeSingle()
    if (error) return { status: 'error' }
    if (!data) return { status: 'missing' }
    const row = data as { value: unknown; updated_at: string | null }
    const texts = parseMemberNotificationTexts(row.value)
    return texts ? { status: 'ok', texts, updatedAt: row.updated_at ?? null } : { status: 'invalid' }
  } catch {
    return { status: 'error' }
  }
}

export async function sendMemberNotification(request: MemberNotificationRequest): Promise<MemberNotificationSendResult> {
  try {
    const texts = await getMemberNotificationTexts()
    if (!texts) return { sent: false, reason: 'texts_unavailable' }
    if (!isMemberNotificationEnabled(request.kind, texts)) return { sent: false, reason: 'disabled' }
    const rendered = renderMemberNotification(request.kind, texts, request)
    if (!rendered) {
      console.error('[member-notifications] 문구를 채우지 못했습니다.', { kind: request.kind })
      return { sent: false, reason: 'render_failed' }
    }
    const { error } = await createAdminClient().from('notifications').insert({
      user_id: request.userId,
      type: rendered.type,
      title: rendered.title,
      message: rendered.message,
      link: rendered.link,
      is_read: false,
    })
    if (error) {
      // 회원 id·글자는 남기지 않는다(오류 코드만)
      console.error('[member-notifications] 알림을 넣지 못했습니다.', { kind: request.kind, errorCode: error.code ?? null })
      return { sent: false, reason: 'insert_failed' }
    }
    return { sent: true }
  } catch {
    console.error('[member-notifications] 알림을 넣지 못했습니다.', { kind: request.kind, errorCode: 'exception' })
    return { sent: false, reason: 'insert_failed' }
  }
}

// 관리자 화면 경로의 응답 칸(6절 표): true 면 화면이 '회원 알림을 보내지 못했습니다…'를 보인다. 꺼 둔 종류(disabled)는 실패가 아니다.
export function notificationFailed(result: MemberNotificationSendResult): boolean {
  return !result.sent && result.reason !== 'disabled'
}
