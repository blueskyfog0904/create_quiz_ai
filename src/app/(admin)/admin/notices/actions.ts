'use server'

import { headers } from 'next/headers'
import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { MEMBER_FACING_PII_LABELS } from '@/lib/member-facing-text-pii'
import {
  SITE_BOARD_CONTENT_CACHE_TAG,
  SITE_BOARD_ERROR_MESSAGES,
  SITE_BOARD_FIELD_LABELS,
  SITE_BOARD_KINDS,
  SITE_BOARD_POSTS_CACHE_TAG,
  SITE_BOARD_REDACT_REASON_CODES,
  isSiteBoardPostId,
  normalizeSiteBoardPostInput,
  siteBoardErrorMessage,
  validateSiteBoardContentInput,
  validateSiteBoardPostInput,
  type SiteBoardContent,
  type SiteBoardKind,
  type SiteBoardPostInput,
  type SiteBoardRedactReasonCode,
} from '@/lib/site-board'
import {
  callDeleteSiteBoardPost,
  callRedactSiteBoardPost,
  callReorderSiteBoardPosts,
  callSaveSiteBoardContent,
  callSaveSiteBoardPost,
  isSiteBoardPreviewEnabled,
  type SiteBoardCallResult,
} from '@/lib/site-board-server'

// 14번 7-1: 공지사항·자주 묻는 질문 관리자 서버 액션(두 화면이 같이 쓴다). 순서: 관리자 확인 → 권한(가림은 대표) → 입력 검사 →
// 서버 키로 DB 함수(권한·판·개인정보·고정 상한·작업 기록을 같은 거래에서) → 캐시 태그 만료. 요청 정보(IP·기기)는 p_request_meta 로 넘긴다.
// 개발 미리보기(SITE_BOARD_PREVIEW)에서는 DB 함수를 부르지 않는다(localhost 도 운영 DB — 저장·삭제·순서·가림을 누르지 않는다).

export type SiteBoardActionResult = { ok: true; changed: boolean; id: string | null } | { ok: false; error: string; conflict: boolean }

const PREVIEW_BLOCKED = '개발 미리보기에서는 저장하지 않습니다(운영 DB 를 쓰지 않음).'
const isBoard = (value: unknown): value is SiteBoardKind => SITE_BOARD_KINDS.includes(value as SiteBoardKind)
const adminPath = (board: SiteBoardKind) => (board === 'notice' ? '/admin/notices' : '/admin/faq')

function invalid(field: string): SiteBoardActionResult {
  return { ok: false, error: `${SITE_BOARD_ERROR_MESSAGES.SITE_BOARD_INPUT_INVALID} (${SITE_BOARD_FIELD_LABELS[field] ?? field})`, conflict: false }
}

function toResult(result: SiteBoardCallResult): SiteBoardActionResult {
  if (result.ok) return { ok: true, changed: result.changed, id: result.id }
  if (!result.error) return { ok: false, error: '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', conflict: false }
  const conflict = result.error.code === 'SITE_BOARD_REVISION_CONFLICT' || result.error.code === 'SITE_BOARD_REORDER_MISMATCH'
  return { ok: false, error: siteBoardErrorMessage(result.error, MEMBER_FACING_PII_LABELS), conflict }
}

function expirePosts(board: SiteBoardKind) {
  revalidateTag(SITE_BOARD_POSTS_CACHE_TAG, { expire: 0 })
  revalidatePath(adminPath(board))
}

export async function saveSiteBoardPostAction(board: SiteBoardKind, id: string | null, expectedRevision: number | null, rawInput: SiteBoardPostInput): Promise<SiteBoardActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('content.manage')
  if (!isBoard(board) || !rawInput || typeof rawInput !== 'object') return invalid('board')
  if (id !== null && (!isSiteBoardPostId(id) || !Number.isInteger(expectedRevision))) return invalid('id')
  if (id === null && expectedRevision !== null) return invalid('revision')
  const input = normalizeSiteBoardPostInput({
    title: String(rawInput.title ?? ''),
    body: String(rawInput.body ?? ''),
    linkUrl: rawInput.linkUrl === null ? null : String(rawInput.linkUrl ?? ''),
    linkLabel: rawInput.linkLabel === null ? null : String(rawInput.linkLabel ?? ''),
    faqCategoryKey: rawInput.faqCategoryKey === null ? null : String(rawInput.faqCategoryKey ?? ''),
    isPinned: rawInput.isPinned === true,
    isPublished: rawInput.isPublished === true,
  })
  // 분류가 설정에 있는지는 DB 함수가 잠금 뒤 다시 본다(여기서는 모양만).
  const field = validateSiteBoardPostInput(board, input, input.faqCategoryKey ? [input.faqCategoryKey] : [])
  if (field) return invalid(field)
  if (isSiteBoardPreviewEnabled()) return { ok: false, error: PREVIEW_BLOCKED, conflict: false }

  const result = toResult(await callSaveSiteBoardPost(access.userId, board, id ? id.toLowerCase() : null, expectedRevision, input, adminRequestMeta(await headers())))
  if (result.ok && result.changed) expirePosts(board)
  return result
}

export async function deleteSiteBoardPostAction(board: SiteBoardKind, id: string, expectedRevision: number): Promise<SiteBoardActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('content.manage')
  if (!isBoard(board) || !isSiteBoardPostId(id) || !Number.isInteger(expectedRevision)) return invalid('id')
  if (isSiteBoardPreviewEnabled()) return { ok: false, error: PREVIEW_BLOCKED, conflict: false }

  const result = toResult(await callDeleteSiteBoardPost(access.userId, id.toLowerCase(), expectedRevision, adminRequestMeta(await headers())))
  if (result.ok) expirePosts(board)
  return result
}

export async function reorderSiteBoardPostsAction(board: SiteBoardKind, scope: string, ids: string[]): Promise<SiteBoardActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('content.manage')
  if (!isBoard(board) || typeof scope !== 'string' || !Array.isArray(ids) || ids.length === 0 || !ids.every(isSiteBoardPostId)) return invalid('ids')
  if (isSiteBoardPreviewEnabled()) return { ok: false, error: PREVIEW_BLOCKED, conflict: false }

  const result = toResult(await callReorderSiteBoardPosts(access.userId, board, scope, ids.map((value) => value.toLowerCase()), adminRequestMeta(await headers())))
  if (result.ok && result.changed) expirePosts(board)
  return result
}

// 가림은 대표만(Q6). 숨김·삭제한 글만 — 게시 중이면 DB 함수가 거절한다.
export async function redactSiteBoardPostAction(board: SiteBoardKind, id: string, reasonCode: SiteBoardRedactReasonCode): Promise<SiteBoardActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (!isBoard(board) || !isSiteBoardPostId(id)) return invalid('id')
  if (!SITE_BOARD_REDACT_REASON_CODES.includes(reasonCode)) return invalid('reasonCode')
  if (isSiteBoardPreviewEnabled()) return { ok: false, error: PREVIEW_BLOCKED, conflict: false }

  const result = toResult(await callRedactSiteBoardPost(access.userId, id.toLowerCase(), reasonCode, adminRequestMeta(await headers())))
  if (result.ok) expirePosts(board)
  return result
}

// 안내 문구 탭(7-4). 문구·분류는 두 화면이 같은 설정 행을 고친다.
export async function saveSiteBoardContentAction(expectedRevision: number, value: Omit<SiteBoardContent, 'revision'>, pinnedCount: number): Promise<SiteBoardActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('content.manage')
  if (!Number.isInteger(expectedRevision) || !value || typeof value !== 'object') return invalid('value')
  const field = validateSiteBoardContentInput(value, Number.isInteger(pinnedCount) ? pinnedCount : 0)
  if (field) return invalid(field)
  if (isSiteBoardPreviewEnabled()) return { ok: false, error: PREVIEW_BLOCKED, conflict: false }

  const result = toResult(await callSaveSiteBoardContent(access.userId, expectedRevision, value, adminRequestMeta(await headers())))
  if (result.ok && result.changed) {
    revalidateTag(SITE_BOARD_CONTENT_CACHE_TAG, { expire: 0 })
    revalidateTag(SITE_BOARD_POSTS_CACHE_TAG, { expire: 0 })
    revalidatePath('/admin/notices')
    revalidatePath('/admin/faq')
  }
  return result
}
