'use server'

import { headers } from 'next/headers'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { MEMBER_FACING_PII_LABELS, memberFacingTextPiiHits } from '@/lib/member-facing-text-pii'
import {
  BROADCAST_MESSAGE_MAX,
  BROADCAST_RETRACT_REASON_CODES,
  BROADCAST_TARGETS,
  BROADCAST_TITLE_MAX,
  MEMBER_NOTIFICATION_ERROR_MESSAGES,
  MEMBER_NOTIFICATION_TEXTS_CACHE_TAG,
  isAllowedBroadcastLink,
  memberNotificationErrorMessage,
  memberNotificationFieldLabel,
  normalizeMemberNotificationTexts,
  validateMemberNotificationTextsInput,
  type BroadcastRetractReasonCode,
  type BroadcastTarget,
  type MemberNotificationErrorCode,
  type MemberNotificationTexts,
} from '@/lib/member-notifications'
import {
  callMemberBroadcastPreview,
  callRetractMemberBroadcast,
  callSaveMemberNotificationTexts,
  callSendMemberBroadcast,
  readBroadcastTermsOptions,
  type MemberBroadcastPreview,
  type MemberNotificationCallResult,
  type SendMemberBroadcastInput,
} from '@/lib/member-broadcast-server'
import { readPiiAllowedContacts } from '@/lib/site-board-server'

// 16번 7절: 관리자 '알림' 화면 서버 액션(대표만, Q1). 순서: 관리자 확인 → 대표 권한 → 입력 검사(TS 규칙) → 서버 키로 DB 함수
// (대표 재확인·판·상한·재요청·개인정보·작업 기록을 같은 거래에서) → 캐시 태그 만료. 요청 정보(IP·기기)는 p_request_meta 로 넘긴다.
// localhost 도 운영 DB 를 쓴다 — 로컬 확인 때는 저장·보내기·회수를 누르지 않는다.

export type MemberNotificationActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; conflict: boolean; code: MemberNotificationErrorCode | null }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value)
const isTarget = (value: unknown): value is BroadcastTarget => BROADCAST_TARGETS.includes(value as BroadcastTarget)
const charLength = (text: string) => [...text].length

function invalid(field: string, code: MemberNotificationErrorCode = 'BROADCAST_INPUT_INVALID'): { ok: false; error: string; conflict: false; code: MemberNotificationErrorCode } {
  return { ok: false, error: `${MEMBER_NOTIFICATION_ERROR_MESSAGES[code]} (${memberNotificationFieldLabel(field)})`, conflict: false, code }
}

function failure<T>(result: MemberNotificationCallResult<T>): { ok: false; error: string; conflict: boolean; code: MemberNotificationErrorCode | null } {
  if (result.ok) throw new Error('unreachable')
  if (!result.error) return { ok: false, error: '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', conflict: false, code: null }
  const conflict = result.error.code === 'MEMBER_NOTIFICATION_REVISION_CONFLICT'
  return { ok: false, error: memberNotificationErrorMessage(result.error, MEMBER_FACING_PII_LABELS), conflict, code: result.error.code }
}

// 알림 문구 탭(7-2): 구조·허용 자리표시는 TS 규칙으로 먼저 보고, DB 함수가 구조·끌 수 없는 종류·개인정보·판을 다시 본다.
export async function saveMemberNotificationTextsAction(
  expectedRevision: number,
  value: MemberNotificationTexts
): Promise<MemberNotificationActionResult<{ changed: boolean; revision: number | null }>> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (!Number.isInteger(expectedRevision) || !value || typeof value !== 'object') return invalid('value', 'MEMBER_NOTIFICATION_INPUT_INVALID')
  let normalized: MemberNotificationTexts
  try {
    normalized = normalizeMemberNotificationTexts({ ...value, revision: expectedRevision })
  } catch {
    return invalid('value', 'MEMBER_NOTIFICATION_INPUT_INVALID')
  }
  const problem = validateMemberNotificationTextsInput(normalized)
  if (problem) return invalid(problem, 'MEMBER_NOTIFICATION_INPUT_INVALID')

  const result = await callSaveMemberNotificationTexts(access.userId, expectedRevision, normalized, adminRequestMeta(await headers()))
  if (!result.ok) return failure(result)
  if (result.data.changed) {
    revalidateTag(MEMBER_NOTIFICATION_TEXTS_CACHE_TAG, { expire: 0 })
    revalidatePath('/admin/notifications')
  }
  return { ok: true, changed: result.data.changed === true, revision: typeof result.data.revision === 'number' ? result.data.revision : null }
}

// 공지 알림 미리보기(7-3): 인원·남은 횟수·다음 가능 시각. 쓰기 없음.
export async function previewMemberBroadcastAction(target: BroadcastTarget): Promise<MemberNotificationActionResult<{ preview: MemberBroadcastPreview }>> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (!isTarget(target)) return invalid('target')
  const result = await callMemberBroadcastPreview(access.userId, target)
  if (!result.ok) return failure(result)
  return { ok: true, preview: result.data }
}

// 공지 알림 보내기(7-3): 미리보기를 거쳤는지는 화면이 강제하고, 서버·DB 는 인원·경계 판·상한·재요청·개인정보·대표를 본다.
export async function sendMemberBroadcastAction(
  input: SendMemberBroadcastInput
): Promise<MemberNotificationActionResult<{ broadcastId: string | null; recipientCount: number | null; replayed: boolean }>> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (!input || typeof input !== 'object') return invalid('value')
  if (!isUuid(input.operationKey)) return invalid('operationKey')
  if (!isTarget(input.target)) return invalid('target')
  const title = String(input.title ?? '').replace(/\r\n?/g, '\n').trim()
  const message = String(input.message ?? '').replace(/\r\n?/g, '\n').trim()
  if (!title || charLength(title) > BROADCAST_TITLE_MAX || title.includes('\n')) return invalid('title')
  if (!message || charLength(message) > BROADCAST_MESSAGE_MAX) return invalid('message')
  const postId = input.postId === null || input.postId === undefined ? null : String(input.postId).toLowerCase()
  if (postId !== null && !isUuid(postId)) return invalid('postId')
  const linkUrl = input.linkUrl === null || input.linkUrl === undefined || String(input.linkUrl).trim() === '' ? null : String(input.linkUrl).trim()
  const terms = await readBroadcastTermsOptions()
  if (!isAllowedBroadcastLink(linkUrl, postId, terms.map((item) => item.slug))) return invalid('linkUrl')
  if (!Number.isInteger(input.expectedCount) || input.expectedCount < 1) return invalid('expectedCount')
  if (!Number.isInteger(input.notAdvertisingVersion) || input.notAdvertisingVersion < 1) {
    return { ok: false, error: MEMBER_NOTIFICATION_ERROR_MESSAGES.BROADCAST_CONFIRM_REQUIRED, conflict: false, code: 'BROADCAST_CONFIRM_REQUIRED' }
  }
  const allowed = await readPiiAllowedContacts()
  const hits = [...new Set([...memberFacingTextPiiHits(title, allowed), ...memberFacingTextPiiHits(message, allowed)])]
  if (hits.length > 0) {
    return {
      ok: false,
      error: `${MEMBER_NOTIFICATION_ERROR_MESSAGES.BROADCAST_PII_SUSPECTED} (${hits.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')})`,
      conflict: false,
      code: 'BROADCAST_PII_SUSPECTED',
    }
  }

  const result = await callSendMemberBroadcast(access.userId, {
    operationKey: input.operationKey,
    target: input.target,
    title,
    message,
    linkUrl,
    postId,
    expectedCount: input.expectedCount,
    notAdvertisingVersion: input.notAdvertisingVersion,
  }, adminRequestMeta(await headers()))
  if (!result.ok) return failure(result)
  revalidatePath('/admin/notifications')
  return {
    ok: true,
    broadcastId: typeof result.data.broadcast_id === 'string' ? result.data.broadcast_id : null,
    recipientCount: typeof result.data.recipient_count === 'number' ? result.data.recipient_count : null,
    replayed: result.data.replayed === true,
  }
}

// 보낸 기록 회수(7-4): 사유는 정해진 코드만. '개인정보가 들어감'이면 가림도 함께(DB 함수도 같은 규칙).
export async function retractMemberBroadcastAction(
  broadcastId: string,
  reasonCode: BroadcastRetractReasonCode,
  redact: boolean
): Promise<MemberNotificationActionResult<{ changed: boolean }>> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (!isUuid(broadcastId)) return invalid('id')
  if (!BROADCAST_RETRACT_REASON_CODES.includes(reasonCode)) return invalid('reasonCode')
  if (typeof redact !== 'boolean' || (reasonCode === 'pii' && !redact)) return invalid('redact')
  const result = await callRetractMemberBroadcast(access.userId, broadcastId, reasonCode, redact, adminRequestMeta(await headers()))
  if (!result.ok) return failure(result)
  revalidatePath('/admin/notifications')
  return { ok: true, changed: result.data.changed === true }
}
