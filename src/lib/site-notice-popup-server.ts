import 'server-only'

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { unstable_cache } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  POLICY_UPCOMING_DOCUMENTS_CACHE_TAG,
  POLICY_UPCOMING_DOCUMENTS_SETTING_KEY,
  SITE_NOTICE_POPUP_CACHE_TAG,
  SITE_NOTICE_POPUP_SETTING_KEY,
  extractNoticePopupErrorCode,
  parsePolicyUpcomingDocuments,
  parsePolicyUpcomingSummary,
  parseSiteNoticePopupValue,
  shouldServeNoticePopup,
  type ActiveSiteNoticePopup,
  type NoticePopupInput,
  type PolicyUpcomingDocuments,
  type PolicyUpcomingSummary,
  type SiteNoticePopupValue,
} from '@/lib/site-notice-popup'

// 15번 계획: 공지 팝업(site_notice_popup)과 변경 예정 약관(policy_upcoming_documents) 서버 읽기·저장.
// 두 행은 서비스 키로만 읽고 쓴다(내용은 공개 글). 저장은 DB 함수 save_site_notice_popup 이 대표 확인·작업 기록까지 한다.

function settingsDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createAdminClient() as unknown as SupabaseClient
}

async function readSettingValue(key: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const db = settingsDb()
  if (!db) return { ok: false }
  const { data, error } = await db.from('system_settings').select('value').eq('key', key).maybeSingle()
  if (error) {
    console.error(`[site-notice-popup] ${key} 읽기 실패`, error.message)
    return { ok: false }
  }
  return { ok: true, value: data?.value ?? null }
}

// ── 10-1. 개발 전용 미리보기(운영 DB 에 쓰지 않고 켜기 전 화면을 본다) ──────────────────────────────
export function isNoticePopupPreviewEnabled() {
  return process.env.NODE_ENV === 'development'
    && !process.env.VERCEL
    && process.env.NOTICE_POPUP_PREVIEW === '1'
}

async function readPreviewUpcomingFile(): Promise<unknown> {
  const file = process.env.NOTICE_POPUP_PREVIEW_UPCOMING_FILE
  if (!isNoticePopupPreviewEnabled() || !file) return null
  try {
    return JSON.parse(await readFile(resolve(process.cwd(), file), 'utf8'))
  } catch {
    // 파일이 없거나 깨졌으면 조용히 없음으로 본다.
    return null
  }
}

// ── 팝업 ────────────────────────────────────────────────────────────────────────────────────────
const getCachedPopupValue = unstable_cache(
  async () => {
    const result = await readSettingValue(SITE_NOTICE_POPUP_SETTING_KEY)
    if (!result.ok) throw new Error('site_notice_popup unavailable')
    return result.value
  },
  ['site-notice-popup-value'],
  { revalidate: 60, tags: [SITE_NOTICE_POPUP_CACHE_TAG] }
)

// 회원 화면 layout 이 부른다. 읽지 못하면 null(팝업 없이 화면을 그린다).
export async function getActiveSiteNoticePopup(nowMs: number): Promise<ActiveSiteNoticePopup | null> {
  let value: SiteNoticePopupValue | null
  try {
    value = parseSiteNoticePopupValue(await getCachedPopupValue())
  } catch (error) {
    console.error('[site-notice-popup] 팝업 읽기 실패', error instanceof Error ? error.message : error)
    return null
  }
  if (!value) return null
  const preview = isNoticePopupPreviewEnabled()
  // 미리보기는 켜기·노출 기간을 보지 않고 저장된 초안을 넘긴다(닫기 저장 규칙은 그대로).
  if (!preview && !shouldServeNoticePopup(value, nowMs)) return null
  if (!/^[0-9a-f]{64}$/.test(value.contentSha256) || !value.title || !value.body) return null
  return {
    title: value.title,
    body: value.body,
    linkUrl: value.linkUrl,
    linkLabel: value.linkLabel,
    startsAt: preview ? null : value.startsAt,
    endsAt: preview ? null : value.endsAt,
    contentSha256: value.contentSha256,
    preview,
  }
}

// ── 변경 예정 글 ───────────────────────────────────────────────────────────────────────────────
const getCachedUpcomingSummary = unstable_cache(
  async () => {
    const result = await readSettingValue(POLICY_UPCOMING_DOCUMENTS_SETTING_KEY)
    if (!result.ok) throw new Error('policy_upcoming_documents unavailable')
    // 캐시에는 상태·한 줄 안내·하단 링크·문서 key/slug 만 남긴다(전문은 담지 않는다).
    return parsePolicyUpcomingSummary(result.value)
  },
  ['policy-upcoming-summary'],
  { revalidate: 60, tags: [POLICY_UPCOMING_DOCUMENTS_CACHE_TAG] }
)

const getCachedUpcomingFull = unstable_cache(
  async () => {
    const result = await readSettingValue(POLICY_UPCOMING_DOCUMENTS_SETTING_KEY)
    if (!result.ok) throw new Error('policy_upcoming_documents unavailable')
    return result.value
  },
  ['policy-upcoming-full'],
  { revalidate: 60, tags: [POLICY_UPCOMING_DOCUMENTS_CACHE_TAG] }
)

// layout·하단·한 줄 안내용 가벼운 읽기. 실패하면 null(하단 링크·한 줄 안내만 그리지 않는다).
export async function getUpcomingPolicySummary(): Promise<PolicyUpcomingSummary | null> {
  try {
    const summary = await getCachedUpcomingSummary()
    if (summary) return summary
    return parsePolicyUpcomingSummary(await readPreviewUpcomingFile())
  } catch (error) {
    console.error('[policy-upcoming] 변경 예정 글 읽기 실패', error instanceof Error ? error.message : error)
    return null
  }
}

// /terms/upcoming 전체 읽기. 행이 없으면 null(화면은 404), 읽기 실패는 던진다(오류 화면).
export async function getUpcomingPolicyDocuments(): Promise<PolicyUpcomingDocuments | null> {
  const full = parsePolicyUpcomingDocuments(await getCachedUpcomingFull())
  if (full) return full
  return parsePolicyUpcomingDocuments(await readPreviewUpcomingFile())
}

// 관리자용(캐시 없음). 미리보기 파일도 적용한다(10-1).
export async function readUpcomingPolicyDocumentsForAdmin(): Promise<{ ok: true; value: PolicyUpcomingDocuments | null } | { ok: false }> {
  const result = await readSettingValue(POLICY_UPCOMING_DOCUMENTS_SETTING_KEY)
  if (!result.ok) return { ok: false }
  const value = parsePolicyUpcomingDocuments(result.value) ?? parsePolicyUpcomingDocuments(await readPreviewUpcomingFile())
  return { ok: true, value }
}

// 관리자 카드용(캐시 없음): 값과 마지막 저장 시각(system_settings.updated_at).
export async function readSiteNoticePopupForAdmin(): Promise<{ value: SiteNoticePopupValue; updatedAt: string | null } | null> {
  const db = settingsDb()
  if (!db) return null
  const { data, error } = await db.from('system_settings').select('value, updated_at').eq('key', SITE_NOTICE_POPUP_SETTING_KEY).maybeSingle()
  if (error) {
    console.error('[site-notice-popup] 관리자 읽기 실패', error.message)
    return null
  }
  const value = parseSiteNoticePopupValue(data?.value)
  return value ? { value, updatedAt: typeof data?.updated_at === 'string' ? data.updated_at : null } : null
}

export type SaveSiteNoticePopupOutcome =
  | { ok: true; changed: boolean; value: SiteNoticePopupValue }
  | { ok: false; code: string }

export async function callSaveSiteNoticePopup(actorId: string, expectedRevision: number, input: NoticePopupInput): Promise<SaveSiteNoticePopupOutcome> {
  const db = settingsDb()
  if (!db) return { ok: false, code: 'NOTICE_POPUP_SAVE_FAILED' }
  const { data, error } = await db.rpc('save_site_notice_popup', {
    p_actor_id: actorId,
    p_expected_revision: expectedRevision,
    p_enabled: input.enabled,
    p_title: input.title,
    p_body: input.body,
    p_link_url: input.linkUrl,
    p_link_label: input.linkLabel,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
  })
  if (error) {
    return { ok: false, code: extractNoticePopupErrorCode(error.message) ?? 'NOTICE_POPUP_SAVE_FAILED' }
  }
  const result = data as { changed?: unknown; value?: unknown } | null
  const value = parseSiteNoticePopupValue(result?.value)
  if (!value) return { ok: false, code: 'NOTICE_POPUP_SAVE_FAILED' }
  return { ok: true, changed: result?.changed === true, value }
}

export interface NoticeContinuityResult {
  ok: boolean
  reason: string | null
  sId: string | null
  lastId: string | null
  sSavedAt: string | null
}

// 고지 끊김 판정(4-2). 인자 없이 부른다 — 시행일·마감일은 DB 함수가 게시 행에서 읽는다.
export async function readNoticeContinuity(): Promise<NoticeContinuityResult | null> {
  const db = settingsDb()
  if (!db) return null
  const { data, error } = await db.rpc('policy_upcoming_notice_continuity')
  if (error || !data || typeof data !== 'object') {
    if (error) console.error('[site-notice-popup] 고지 끊김 판정 실패', error.message)
    return null
  }
  const row = data as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  return {
    ok: row.ok === true,
    reason: text(row.reason),
    sId: text(row.s_id),
    lastId: text(row.last_id),
    sSavedAt: text(row.s_saved_at),
  }
}
