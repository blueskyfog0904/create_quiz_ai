'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import {
  SITE_NOTICE_POPUP_CACHE_TAG,
  normalizeNoticePopupInput,
  validateNoticePopupInput,
  type NoticePopupInput,
  type PolicyUpcomingStatus,
  type SiteNoticePopupValue,
} from '@/lib/site-notice-popup'
import {
  callSaveSiteNoticePopup,
  readNoticeContinuity,
  readSiteNoticePopupForAdmin,
  readUpcomingPolicyDocumentsForAdmin,
  type NoticeContinuityResult,
} from '@/lib/site-notice-popup-server'

// 공지 팝업(15번 계획 7절, 대표 전용). 저장·작업 기록은 DB 함수 save_site_notice_popup 이 같은 거래에서 한다(대표 확인도 다시 함).
// 변경 예정 글(policy_upcoming_documents)은 이 화면에서 고치지 않는다(스크립트로만) — 읽기만 한다.

export interface NoticePopupUpcomingView {
  status: PolicyUpcomingStatus
  effectiveDate: string
  effectiveDateLabel: string
  publishedAt: string
  documents: { key: string; title: string; slug: string; sha256: string; changeCount: number }[]
  consentItems: { key: string; label: string; sha256: string }[]
}

export type NoticePopupAdminData =
  | {
      ok: true
      popup: SiteNoticePopupValue
      popupUpdatedAt: string | null
      upcoming: NoticePopupUpcomingView | null
      // 게시 행이 upcoming 일 때만 부른다(런북과 같은 판정 함수, 인자 없이).
      continuity: NoticeContinuityResult | null
    }
  | { ok: false; error: string }

const NOTICE_POPUP_ERRORS: Record<string, string> = {
  NOTICE_POPUP_ACTOR_NOT_OWNER: '대표 계정만 바꿀 수 있습니다.',
  NOTICE_POPUP_REVISION_CONFLICT: '그 사이 다른 곳에서 공지 팝업이 바뀌었습니다. 최신 내용을 다시 불러왔으니 확인 후 다시 저장하세요.',
  NOTICE_POPUP_INPUT_INVALID: '입력값을 확인해 주세요.',
  NOTICE_POPUP_NOT_FOUND: '공지 팝업 설정이 없습니다. DB 적용 상태를 확인해 주세요.',
}

async function loadAdminView(): Promise<NoticePopupAdminData> {
  const [popupRow, upcoming] = await Promise.all([readSiteNoticePopupForAdmin(), readUpcomingPolicyDocumentsForAdmin()])
  if (!popupRow || !upcoming.ok) {
    return { ok: false, error: '공지 팝업 설정을 불러오지 못했습니다.' }
  }
  const row = upcoming.value
  const view: NoticePopupUpcomingView | null = row
    ? {
        status: row.status,
        effectiveDate: row.effectiveDate,
        effectiveDateLabel: row.effectiveDateLabel,
        publishedAt: row.publishedAt,
        documents: row.documents.map((document) => ({
          key: document.key,
          title: document.title,
          slug: document.slug,
          sha256: document.sha256,
          changeCount: document.changes.length,
        })),
        consentItems: row.consentItems.map((item) => ({ key: item.key, label: item.label, sha256: item.sha256 })),
      }
    : null
  const continuity = view?.status === 'upcoming' ? await readNoticeContinuity() : null
  return { ok: true, popup: popupRow.value, popupUpdatedAt: popupRow.updatedAt, upcoming: view, continuity }
}

export async function getNoticePopupAdminData(): Promise<NoticePopupAdminData> {
  await requireAdmin()
  await assertAdminActionPermission('owner')
  return loadAdminView()
}

export type NoticePopupSaveResult =
  | { success: true; changed: boolean; data: NoticePopupAdminData }
  | { success: false; error: string; code: string; data: NoticePopupAdminData | null }

export async function saveNoticePopupAction(expectedRevision: number, rawInput: NoticePopupInput): Promise<NoticePopupSaveResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (!Number.isInteger(expectedRevision) || !rawInput || typeof rawInput !== 'object') {
    return { success: false, error: NOTICE_POPUP_ERRORS.NOTICE_POPUP_INPUT_INVALID, code: 'NOTICE_POPUP_INPUT_INVALID', data: null }
  }
  const input = normalizeNoticePopupInput({
    enabled: rawInput.enabled === true,
    title: String(rawInput.title ?? ''),
    body: String(rawInput.body ?? ''),
    linkUrl: rawInput.linkUrl === null ? null : String(rawInput.linkUrl ?? ''),
    linkLabel: rawInput.linkLabel === null ? null : String(rawInput.linkLabel ?? ''),
    startsAt: rawInput.startsAt === null ? null : String(rawInput.startsAt ?? ''),
    endsAt: rawInput.endsAt === null ? null : String(rawInput.endsAt ?? ''),
  })
  if (validateNoticePopupInput(input, Date.now())) {
    return { success: false, error: NOTICE_POPUP_ERRORS.NOTICE_POPUP_INPUT_INVALID, code: 'NOTICE_POPUP_INPUT_INVALID', data: null }
  }

  const outcome = await callSaveSiteNoticePopup(access.userId, expectedRevision, input)
  if (!outcome.ok) {
    // 판 충돌이면 최신 값을 다시 읽어 돌려준다.
    const data = outcome.code === 'NOTICE_POPUP_REVISION_CONFLICT' ? await loadAdminView() : null
    return {
      success: false,
      error: NOTICE_POPUP_ERRORS[outcome.code] ?? '공지 팝업을 저장하지 못했습니다.',
      code: outcome.code,
      data,
    }
  }
  if (outcome.changed) {
    revalidateTag(SITE_NOTICE_POPUP_CACHE_TAG, { expire: 0 })
    revalidatePath('/admin/footer')
  }
  // 저장 뒤 고지 끊김 판정 결과를 바로 보인다(7-2).
  return { success: true, changed: outcome.changed, data: await loadAdminView() }
}
