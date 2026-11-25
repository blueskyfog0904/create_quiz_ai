import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { FOOTER_PRIVACY_POLICY_SLUG, getFooterBrandName, SITE_FOOTER_CONTENT_SETTING_KEY } from '@/lib/footer-content'
import { inspectRawFooterPolicyDocument } from '@/lib/footer-policy-raw'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { getSiteBrand } from '@/lib/site-brand-server'
import {
  extractConsentErrorCode,
  normalizeSignupConsentTexts,
  SIGNUP_CONSENT_TEXTS_SETTING_KEY,
  type ConsentItem,
  type ConsentRecordResult,
  type ConsentSubmissionItem,
  type SignupConsentTexts,
} from '@/lib/signup-consent'
import { POLICY_UPCOMING_LOCKED_CODE, isPolicyUpcomingLockedMessage } from '@/lib/site-notice-popup'

// 새 표·함수는 생성된 DB 타입에 아직 없으므로 타입 없는 서버 키 클라이언트로 부른다(선례 market-cart-server).
function consentDb() {
  return createAdminClient() as unknown as SupabaseClient
}

type ItemRow = {
  id: string
  key: string
  label: string
  content: string
  required: boolean
  policy_slug: string | null
  required_lock: boolean | null
  sort_order: number
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

type VersionRow = {
  item_id: string
  version: number
  note: string | null
  created_at: string
}

export type ConsentFormData =
  | {
      ok: true
      items: ConsentItem[]
      texts: SignupConsentTexts
      privacyPolicyHref: string
    }
  | { ok: false; code: 'CONSENT_LOAD_FAILED' | 'CONSENT_POLICY_UNAVAILABLE' }

export async function readSignupConsentTexts(): Promise<SignupConsentTexts | null> {
  const { data, error } = await consentDb()
    .from('system_settings')
    .select('value')
    .eq('key', SIGNUP_CONSENT_TEXTS_SETTING_KEY)
    .maybeSingle()
  if (error || !data?.value) {
    return null
  }
  const texts = normalizeSignupConsentTexts(data.value)
  return Object.values(texts).some((text) => !text) ? null : texts
}

async function readRawFooterContent(): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const { data, error } = await consentDb()
    .from('system_settings')
    .select('value')
    .eq('key', SITE_FOOTER_CONTENT_SETTING_KEY)
    .maybeSingle()
  if (error || !data?.value) {
    return { ok: false }
  }
  return { ok: true, value: data.value }
}

// 정규화하지 않은 원본으로 약관 문서를 판정한다(빈 값·오류를 기본 약관으로 바꾸지 않는다).
export async function readRawPolicyDocument(slug: string) {
  const raw = await readRawFooterContent()
  if (!raw.ok) {
    return { ok: false as const, reason: 'missing' as const }
  }
  return inspectRawFooterPolicyDocument(raw.value, slug)
}

async function readItems(options: { activeOnly: boolean }) {
  let query = consentDb()
    .from('signup_consent_items')
    .select('id, key, label, content, required, policy_slug, required_lock, sort_order, is_active, version, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (options.activeOnly) {
    query = query.eq('is_active', true)
  }
  const { data, error } = await query
  if (error) {
    return null
  }
  return (data ?? []) as ItemRow[]
}

async function readCurrentVersions(items: Pick<ItemRow, 'id' | 'version'>[]) {
  if (items.length === 0) return new Map<string, VersionRow>()
  const { data, error } = await consentDb()
    .from('signup_consent_item_versions')
    .select('item_id, version, note, created_at')
    .in('item_id', items.map((item) => item.id))
  if (error) {
    return null
  }
  const wanted = new Map(items.map((item) => [item.id, item.version]))
  const map = new Map<string, VersionRow>()
  for (const row of (data ?? []) as VersionRow[]) {
    if (wanted.get(row.item_id) === row.version) {
      map.set(row.item_id, row)
    }
  }
  return map
}

// 가입·카카오 확인·동의 화면이 함께 쓰는 동의 UI 데이터. 필수 항목의 연결 약관이나 개인정보처리방침을
// 불러올 수 없으면 동의를 멈춘다(선택 항목은 링크만 숨긴다).
export async function loadConsentFormData(): Promise<ConsentFormData> {
  const [rows, texts, raw] = await Promise.all([readItems({ activeOnly: true }), readSignupConsentTexts(), readRawFooterContent()])
  if (!rows || !texts || rows.length === 0) {
    return { ok: false, code: 'CONSENT_LOAD_FAILED' }
  }
  const versions = await readCurrentVersions(rows)
  if (!versions) {
    return { ok: false, code: 'CONSENT_LOAD_FAILED' }
  }
  if (!raw.ok) {
    return { ok: false, code: 'CONSENT_POLICY_UNAVAILABLE' }
  }
  const privacy = inspectRawFooterPolicyDocument(raw.value, FOOTER_PRIVACY_POLICY_SLUG)
  if (!privacy.ok) {
    return { ok: false, code: 'CONSENT_POLICY_UNAVAILABLE' }
  }

  const items: ConsentItem[] = []
  for (const row of rows) {
    let policyHref: string | null = null
    if (row.policy_slug) {
      const document = inspectRawFooterPolicyDocument(raw.value, row.policy_slug)
      if (document.ok) {
        policyHref = document.href
      } else if (row.required) {
        return { ok: false, code: 'CONSENT_POLICY_UNAVAILABLE' }
      }
    }
    const version = versions.get(row.id)
    items.push({
      id: row.id,
      version: row.version,
      label: row.label,
      content: row.content,
      required: row.required,
      policyHref,
      note: version?.note ?? null,
      revisedAt: version?.note ? version.created_at : null,
    })
  }

  return { ok: true, items, texts, privacyPolicyHref: privacy.href }
}

// 이메일 가입 사전 검사(계정을 만들기 전에). 문제없으면 null, 아니면 오류 이름.
export async function validateConsentSubmission(items: ConsentSubmissionItem[]) {
  const form = await loadConsentFormData()
  if (!form.ok) {
    return form.code
  }
  const { data, error } = await consentDb().rpc('consent_validate_submission', { p_items: items })
  if (error) {
    return extractConsentErrorCode(error.message) ?? 'CONSENT_LOAD_FAILED'
  }
  return typeof data === 'string' && data ? data : null
}

export type RecordConsentsOutcome =
  | { ok: true; results: ConsentRecordResult[] }
  | { ok: false; code: string }

export async function recordUserConsents(
  userId: string,
  items: ConsentSubmissionItem[],
  source: 'email_signup' | 'consent_gate' | 'mypage'
): Promise<RecordConsentsOutcome> {
  if (source !== 'mypage') {
    const form = await loadConsentFormData()
    if (!form.ok) {
      return { ok: false, code: form.code }
    }
  }
  const { data, error } = await consentDb().rpc('record_user_consents', {
    p_user_id: userId,
    p_items: items,
    p_source: source,
  })
  if (error) {
    return { ok: false, code: extractConsentErrorCode(error.message) ?? 'CONSENT_RECORD_FAILED' }
  }
  return { ok: true, results: Array.isArray(data) ? data as ConsentRecordResult[] : [] }
}

// 처리 결과 안내의 전송자: 하단 상호명, 없으면 사이트 이름(DB 값).
export async function getConsentSenderName() {
  const [footer, brand] = await Promise.all([getSiteFooterContent(), getSiteBrand()])
  return getFooterBrandName(footer, brand.name)
}

export type ProfileConsentState = { provider: string | null; signupCompleted: boolean } | null

export async function readProfileConsentState(userId: string): Promise<{ ok: true; profile: ProfileConsentState } | { ok: false }> {
  const { data, error } = await consentDb()
    .from('profiles')
    .select('provider, signup_completed')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    return { ok: false }
  }
  if (!data) {
    return { ok: true, profile: null }
  }
  return { ok: true, profile: { provider: data.provider ?? null, signupCompleted: data.signup_completed === true } }
}

type ConsentLogRow = {
  item_id: string
  item_version: number
  agreed: boolean
  source: string
  created_at: string
  seq: number
  policy_sha256?: string | null
}

// 회원 화면(선택 동의 관리)은 약관 지문 열을 읽지 않는다 — 배포 순서와 상관없이 동작하게(지문은 관리자 회원 상세에서만).
async function readConsentLog(userId: string, options: { withPolicyHash?: boolean } = {}) {
  const { data, error } = await consentDb()
    .from('user_consents')
    .select(options.withPolicyHash
      ? 'item_id, item_version, agreed, source, created_at, seq, policy_sha256'
      : 'item_id, item_version, agreed, source, created_at, seq')
    .eq('user_id', userId)
    .order('seq', { ascending: false })
    .limit(500)
  if (error) {
    return null
  }
  return (data ?? []) as unknown as ConsentLogRow[]
}

export type OptionalConsentEntry = {
  id: string
  version: number
  label: string
  content: string
  isActive: boolean
  latest: { agreed: boolean; createdAt: string; itemVersion: number } | null
}

// 선택 동의 관리: 보이는 선택 항목 + 숨겼지만 이 회원의 최신 기록이 동의인 선택 항목. 각 항목은 버전과 상관없이 seq 가 가장 큰 기록.
export async function readMyOptionalConsents(userId: string): Promise<OptionalConsentEntry[] | null> {
  const [rows, log] = await Promise.all([readItems({ activeOnly: false }), readConsentLog(userId)])
  if (!rows || !log) {
    return null
  }
  const latestByItem = new Map<string, ConsentLogRow>()
  for (const row of log) {
    if (!latestByItem.has(row.item_id)) {
      latestByItem.set(row.item_id, row)
    }
  }
  return rows
    .filter((row) => !row.required)
    .filter((row) => row.is_active || latestByItem.get(row.id)?.agreed === true)
    .map((row) => {
      const latest = latestByItem.get(row.id)
      return {
        id: row.id,
        version: row.version,
        label: row.label,
        content: row.content,
        isActive: row.is_active,
        latest: latest ? { agreed: latest.agreed, createdAt: latest.created_at, itemVersion: latest.item_version } : null,
      }
    })
}

export type MemberConsentHistoryEntry = {
  itemLabel: string
  itemVersion: number
  required: boolean
  agreed: boolean
  source: string
  createdAt: string
  // 연결 약관이 있는 항목: 동의 당시 저장 본문의 sha256(6번 묶음 이전 기록·연결 약관 없음이면 null)
  policySha256: string | null
  hasPolicy: boolean
}

// 회원 상세(관리자): 동의 기록 전체(최신순).
export async function readMemberConsentHistory(userId: string): Promise<MemberConsentHistoryEntry[] | null> {
  const [rows, log] = await Promise.all([readItems({ activeOnly: false }), readConsentLog(userId, { withPolicyHash: true })])
  if (!rows || !log) {
    return null
  }
  const itemById = new Map(rows.map((row) => [row.id, row]))
  return log.map((row) => ({
    itemLabel: itemById.get(row.item_id)?.label ?? '(지운 항목)',
    itemVersion: row.item_version,
    required: itemById.get(row.item_id)?.required ?? false,
    agreed: row.agreed,
    source: row.source,
    createdAt: row.created_at,
    policySha256: row.policy_sha256 ?? null,
    hasPolicy: Boolean(itemById.get(row.item_id)?.policy_slug),
  }))
}

export type AdminConsentItem = ItemRow & {
  agreedMembers: number | null
  revisedAt: string | null
  note: string | null
}

export async function readConsentItemsForAdmin(): Promise<AdminConsentItem[] | null> {
  const rows = await readItems({ activeOnly: false })
  if (!rows) {
    return null
  }
  const [versions, stats] = await Promise.all([
    readCurrentVersions(rows),
    consentDb().rpc('signup_consent_item_stats'),
  ])
  if (!versions) {
    return null
  }
  const statsById = new Map<string, number>()
  if (!stats.error && Array.isArray(stats.data)) {
    for (const row of stats.data as { item_id: string; agreed_members: number }[]) {
      statsById.set(row.item_id, row.agreed_members)
    }
  }
  return rows.map((row) => {
    const version = versions.get(row.id)
    return {
      ...row,
      agreedMembers: statsById.get(row.id) ?? null,
      revisedAt: version?.created_at ?? null,
      note: version?.note ?? null,
    }
  })
}

export async function readSignupConsentTextsForAdmin() {
  const { data, error } = await consentDb()
    .from('system_settings')
    .select('value')
    .eq('key', SIGNUP_CONSENT_TEXTS_SETTING_KEY)
    .maybeSingle()
  if (error || !data?.value) {
    return null
  }
  return normalizeSignupConsentTexts(data.value)
}

export async function saveSignupConsentTexts(texts: SignupConsentTexts) {
  const { error, count } = await consentDb()
    .from('system_settings')
    .update({ value: texts, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('key', SIGNUP_CONSENT_TEXTS_SETTING_KEY)
  if (error || count !== 1) {
    throw new Error('가입 동의 안내 문구를 저장하지 못했습니다.')
  }
}

// 활성 필수 항목이 연결한 약관 slug(하단 정보 저장 검사용).
export async function readProtectedPolicySlugs(): Promise<string[] | null> {
  const rows = await readItems({ activeOnly: true })
  if (!rows) {
    return null
  }
  return rows.filter((row) => row.required && row.policy_slug).map((row) => row.policy_slug as string)
}

export type SaveConsentItemInput = {
  id: string | null
  expectedVersion: number | null
  expectedUpdatedAt: string | null
  label: string
  content: string
  required: boolean
  policySlug: string | null
  sortOrder: number
  isActive: boolean
  note: string | null
}

export type ConsentItemSaveResult = {
  dry_run: boolean
  changed?: boolean
  id: string | null
  before_version: number | null
  after_version: number
  version_bump: boolean
  reconsent: boolean
  affected_members?: number
  changed_fields: string[]
  updated_at?: string
}

// 고지 기간에는 이용약관·개인정보 동의 항목 저장이 DB 트리거(POLICY_UPCOMING_LOCKED)로 막힌다(15번 7-3).
// extractConsentErrorCode 는 CONSENT_* 만 잡으므로 먼저 본다.
function consentSaveErrorCode(message: string) {
  if (isPolicyUpcomingLockedMessage(message)) return POLICY_UPCOMING_LOCKED_CODE
  return extractConsentErrorCode(message) ?? 'CONSENT_SAVE_FAILED'
}

export async function callSaveConsentItem(actorId: string, input: SaveConsentItemInput, dryRun: boolean) {
  const { data, error } = await consentDb().rpc('save_signup_consent_item', {
    p_actor_id: actorId,
    p_id: input.id,
    p_expected_version: input.expectedVersion,
    p_label: input.label,
    p_content: input.content,
    p_required: input.required,
    p_policy_slug: input.policySlug,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
    p_note: input.note,
    // PostgREST 가 준 문자열(마이크로초)을 그대로 돌려보낸다 — Date 로 바꾸면 밀리초로 잘려 늘 충돌한다.
    p_expected_updated_at: input.expectedUpdatedAt,
    p_dry_run: dryRun,
  })
  if (error) {
    return { ok: false as const, code: consentSaveErrorCode(error.message) }
  }
  return { ok: true as const, result: data as ConsentItemSaveResult }
}

export async function callReviseConsentItem(actorId: string, id: string, expectedVersion: number, note: string | null, dryRun: boolean) {
  const { data, error } = await consentDb().rpc('revise_signup_consent_item', {
    p_actor_id: actorId,
    p_id: id,
    p_expected_version: expectedVersion,
    p_note: note,
    p_dry_run: dryRun,
  })
  if (error) {
    return { ok: false as const, code: consentSaveErrorCode(error.message) }
  }
  return { ok: true as const, result: data as ConsentItemSaveResult }
}

// 동의 화면에 보일 선택 항목을 고르려고: 이 회원이 현재 버전에 기록을 남긴 항목 id.
export async function readItemIdsWithCurrentRecord(userId: string, items: Pick<ConsentItem, 'id' | 'version'>[]) {
  if (items.length === 0) return new Set<string>()
  const { data, error } = await consentDb()
    .from('user_consents')
    .select('item_id, item_version')
    .eq('user_id', userId)
    .in('item_id', items.map((item) => item.id))
  if (error) {
    return null
  }
  const versions = new Map(items.map((item) => [item.id, item.version]))
  return new Set(
    ((data ?? []) as { item_id: string; item_version: number }[])
      .filter((row) => versions.get(row.item_id) === row.item_version)
      .map((row) => row.item_id)
  )
}

export type PolicyDocumentSnapshot = {
  id: string
  seq: number
  docKey: string
  slug: string | null
  title: string | null
  content: string
  contentSha256: string
  createdAt: string
}

// 약관 본문 이력(6번 묶음): 문서별 사본을 최신순으로. hash 를 주면 그 본문만.
export async function readPolicyDocumentSnapshots(options: { hash?: string | null; limit?: number } = {}): Promise<PolicyDocumentSnapshot[] | null> {
  let query = consentDb()
    .from('policy_document_snapshots')
    .select('id, seq, doc_key, slug, title, content, content_sha256, created_at')
    .order('seq', { ascending: false })
    .limit(options.limit ?? 200)
  if (options.hash) {
    query = query.eq('content_sha256', options.hash)
  }
  const { data, error } = await query
  if (error) {
    return null
  }
  return ((data ?? []) as {
    id: string; seq: number; doc_key: string; slug: string | null; title: string | null; content: string; content_sha256: string; created_at: string
  }[]).map((row) => ({
    id: row.id,
    seq: row.seq,
    docKey: row.doc_key,
    slug: row.slug,
    title: row.title,
    content: row.content,
    contentSha256: row.content_sha256,
    createdAt: row.created_at,
  }))
}
