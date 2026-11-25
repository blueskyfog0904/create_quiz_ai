import { normalizePathname, stripWorkspacePrefix } from '@/lib/workspace-subject'

// 15번 계획(공지 팝업·변경 예정 약관 고지)의 순수 규칙. 서버·브라우저·시험이 같이 쓴다.
// 공지 문구·날짜·경로는 모두 DB 값(system_settings 'site_notice_popup'·'policy_upcoming_documents')이다. 여기에는 규칙만 둔다.

export const SITE_NOTICE_POPUP_SETTING_KEY = 'site_notice_popup'
export const POLICY_UPCOMING_DOCUMENTS_SETTING_KEY = 'policy_upcoming_documents'
export const SITE_NOTICE_POPUP_CACHE_TAG = 'site_notice_popup'
export const POLICY_UPCOMING_DOCUMENTS_CACHE_TAG = 'policy_upcoming_documents'
// 변경 예정 글 화면의 고정 경로(코드의 화면 경로). 팝업은 이 화면 위에 뜨지 않는다.
export const POLICY_UPCOMING_PATH = '/terms/upcoming'
export const POLICY_UPCOMING_LOCKED_CODE = 'POLICY_UPCOMING_LOCKED'

export const NOTICE_POPUP_TITLE_MAX = 60
export const NOTICE_POPUP_BODY_MAX = 1200
export const NOTICE_POPUP_LINK_MAX = 200
export const NOTICE_POPUP_LINK_LABEL_MAX = 20

export interface SiteNoticePopupValue {
  enabled: boolean
  title: string
  body: string
  linkUrl: string | null
  linkLabel: string | null
  startsAt: string | null
  endsAt: string | null
  contentSha256: string
  revision: number
}

// 회원 화면에 넘기는 팝업(서버가 고른 행). preview 는 개발 전용 미리보기(10-1)일 때만 true.
export interface ActiveSiteNoticePopup {
  title: string
  body: string
  linkUrl: string | null
  linkLabel: string | null
  startsAt: string | null
  endsAt: string | null
  contentSha256: string
  preview: boolean
}

export type PolicyUpcomingStatus = 'upcoming' | 'applied' | 'reverted'

export interface PolicyUpcomingChange {
  label: string
  mode: 'replace' | 'insert'
  before: string
  after: string
}

export interface PolicyUpcomingDocument {
  key: string
  slug: string
  title: string
  content: string
  sha256: string
  beforeContent: string
  beforeSha256: string
  changes: PolicyUpcomingChange[]
  changesSha256: string
}

export interface PolicyUpcomingConsentItem {
  key: string
  label: string
  version: number
  content: string
  note: string
  sha256: string
  contentSha256: string
}

export interface PolicyUpcomingLabels {
  currentLinkUpcoming: string
  currentLinkApplied: string
  afterFull: string
  beforeFull: string
  consentSection: string
  before: string
  after: string
  checking: string
  // /terms/upcoming 머리·목차·돌아가기 칸 이름(DB 값)
  effectiveDate: string
  publishedAt: string
  toc: string
  backToList: string
}

export interface PolicyUpcomingStatusTexts {
  applied: string
  revertedAfterApply: string
  withdrawn: string
  historyLinkLabel: string
}

export interface PolicyUpcomingDocuments {
  status: PolicyUpcomingStatus
  effectiveDate: string
  effectiveDateLabel: string
  noticeDeadline: string
  publishedAt: string
  appliedAt: string | null
  revertedAt: string | null
  heading: string
  intro: string
  bannerText: string
  bannerLinkLabel: string
  footerLinkLabel: string
  statusTexts: PolicyUpcomingStatusTexts
  labels: PolicyUpcomingLabels
  documents: PolicyUpcomingDocument[]
  consentItems: PolicyUpcomingConsentItem[]
}

// 하단 링크·한 줄 안내용 가벼운 값(전문·대조·동의 항목은 들고 있지 않다, 6-2).
export interface PolicyUpcomingSummary {
  status: PolicyUpcomingStatus
  effectiveDate: string
  bannerText: string
  bannerLinkLabel: string
  footerLinkLabel: string
  historyLinkLabel: string
  documents: { key: string; slug: string }[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' ? value : '')
const strOrNull = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null)
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

export function parseSiteNoticePopupValue(raw: unknown): SiteNoticePopupValue | null {
  if (!isRecord(raw)) return null
  const revision = Number(raw.revision)
  if (typeof raw.enabled !== 'boolean' || !Number.isInteger(revision)) return null
  return {
    enabled: raw.enabled,
    title: str(raw.title),
    body: str(raw.body),
    linkUrl: strOrNull(raw.linkUrl),
    linkLabel: strOrNull(raw.linkLabel),
    startsAt: strOrNull(raw.startsAt),
    endsAt: strOrNull(raw.endsAt),
    contentSha256: str(raw.contentSha256),
    revision,
  }
}

function parseStatus(value: unknown): PolicyUpcomingStatus | null {
  return value === 'upcoming' || value === 'applied' || value === 'reverted' ? value : null
}

export function parsePolicyUpcomingSummary(raw: unknown): PolicyUpcomingSummary | null {
  if (!isRecord(raw)) return null
  const status = parseStatus(raw.status)
  if (!status) return null
  const statusTexts = isRecord(raw.statusTexts) ? raw.statusTexts : {}
  const documents = Array.isArray(raw.documents) ? raw.documents.filter(isRecord) : []
  return {
    status,
    effectiveDate: str(raw.effectiveDate),
    bannerText: str(raw.bannerText),
    bannerLinkLabel: str(raw.bannerLinkLabel),
    footerLinkLabel: str(raw.footerLinkLabel),
    historyLinkLabel: str(statusTexts.historyLinkLabel),
    documents: documents.map((document) => ({ key: str(document.key), slug: str(document.slug) })).filter((document) => document.key && document.slug),
  }
}

export function parsePolicyUpcomingDocuments(raw: unknown): PolicyUpcomingDocuments | null {
  if (!isRecord(raw)) return null
  const status = parseStatus(raw.status)
  if (!status) return null
  const statusTexts = isRecord(raw.statusTexts) ? raw.statusTexts : {}
  const labels = isRecord(raw.labels) ? raw.labels : {}
  const documents = (Array.isArray(raw.documents) ? raw.documents : []).filter(isRecord).map((document) => ({
    key: str(document.key),
    slug: str(document.slug),
    title: str(document.title),
    content: str(document.content),
    sha256: str(document.sha256),
    beforeContent: str(document.beforeContent),
    beforeSha256: str(document.beforeSha256),
    changes: (Array.isArray(document.changes) ? document.changes : []).filter(isRecord).map((change) => ({
      label: str(change.label),
      mode: change.mode === 'insert' ? 'insert' as const : 'replace' as const,
      before: str(change.before),
      after: str(change.after),
    })),
    changesSha256: str(document.changesSha256),
  }))
  const consentItems = (Array.isArray(raw.consentItems) ? raw.consentItems : []).filter(isRecord).map((item) => ({
    key: str(item.key),
    label: str(item.label),
    version: Number(item.version) || 0,
    content: str(item.content),
    note: str(item.note),
    sha256: str(item.sha256),
    contentSha256: str(item.contentSha256),
  }))
  return {
    status,
    effectiveDate: str(raw.effectiveDate),
    effectiveDateLabel: str(raw.effectiveDateLabel),
    noticeDeadline: str(raw.noticeDeadline),
    publishedAt: str(raw.publishedAt),
    appliedAt: strOrNull(raw.appliedAt),
    revertedAt: strOrNull(raw.revertedAt),
    heading: str(raw.heading),
    intro: str(raw.intro),
    bannerText: str(raw.bannerText),
    bannerLinkLabel: str(raw.bannerLinkLabel),
    footerLinkLabel: str(raw.footerLinkLabel),
    statusTexts: {
      applied: str(statusTexts.applied),
      revertedAfterApply: str(statusTexts.revertedAfterApply),
      withdrawn: str(statusTexts.withdrawn),
      historyLinkLabel: str(statusTexts.historyLinkLabel),
    },
    labels: {
      currentLinkUpcoming: str(labels.currentLinkUpcoming),
      currentLinkApplied: str(labels.currentLinkApplied),
      afterFull: str(labels.afterFull),
      beforeFull: str(labels.beforeFull),
      consentSection: str(labels.consentSection),
      before: str(labels.before),
      after: str(labels.after),
      checking: str(labels.checking),
      effectiveDate: str(labels.effectiveDate),
      publishedAt: str(labels.publishedAt),
      toc: str(labels.toc),
      backToList: str(labels.backToList),
    },
    documents,
    consentItems,
  }
}

// labels 의 {제목} 자리만 코드가 문서 제목으로 채운다(글은 DB 값).
export function fillPolicyTitle(template: string, title: string) {
  return template.split('{제목}').join(title)
}

// 문서별 앵커: 문서 slug(#service 등). 동의 항목 칸은 #consent.
export const POLICY_UPCOMING_CONSENT_ANCHOR = 'consent'
export function policyUpcomingHref(slug?: string | null) {
  return slug ? `${POLICY_UPCOMING_PATH}#${slug}` : POLICY_UPCOMING_PATH
}

// ── 5-1. 팝업을 띄우지 않는 경로 ─────────────────────────────────────────────────────────────────
const EXCLUDED_PREFIXES = [
  '/admin',
  '/dashboard/admin',
  '/pricing',
  '/checkout',
  '/cart',
  POLICY_UPCOMING_PATH,
  '/consent',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/preview',
] as const

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

// 링크 주소에서 쿼리·# 을 뗀 경로(정규화). '/' 면 null(홈에서 팝업이 사라지지 않게).
function linkPathOf(linkUrl: string | null | undefined) {
  if (!linkUrl) return null
  const path = normalizePathname(linkUrl.split(/[?#]/)[0] ?? '')
  return path === '/' ? null : path
}

export function isNoticePopupExcludedPath(pathname: string, linkUrl?: string | null) {
  const normalized = normalizePathname(pathname.split(/[?#]/)[0] ?? '')
  const scoped = stripWorkspacePrefix(normalized).scopedPath
  const linkPath = linkPathOf(linkUrl)
  return [normalized, scoped].some((path) =>
    EXCLUDED_PREFIXES.some((prefix) => matchesPrefix(path, prefix)) || (linkPath !== null && path === linkPath)
  )
}

// ── 5-2. 노출 판정 ──────────────────────────────────────────────────────────────────────────────
function toMs(value: string | null | undefined) {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

// 서버가 넘길지: 켜짐, 끝이 있고 지금 < 끝, 지문 형식. 시작이 미래여도 넘긴다(브라우저가 본다).
export function shouldServeNoticePopup(value: SiteNoticePopupValue | null, nowMs: number) {
  if (!value || !value.enabled || !isSha256Hex(value.contentSha256)) return false
  const endsAt = toMs(value.endsAt)
  return endsAt !== null && nowMs < endsAt
}

// 브라우저가 지금 띄울지: 시작 ≤ 지금 < 끝(시작이 없으면 켠 때부터). 경계: 지금 = 시작 보임, 지금 = 끝 안 보임.
export function isNoticePopupInWindow(popup: Pick<ActiveSiteNoticePopup, 'startsAt' | 'endsAt' | 'contentSha256'>, nowMs: number) {
  if (!isSha256Hex(popup.contentSha256)) return false
  const startsAt = toMs(popup.startsAt)
  const endsAt = toMs(popup.endsAt)
  if (endsAt === null || nowMs >= endsAt) return false
  return startsAt === null || nowMs >= startsAt
}

// 주소에 로그인·로그아웃 완료 표시가 있으면 이번에는 열지 않는다(로그인 완료 창과 겹치지 않게).
export function hasAuthCompleteQuery(search: string) {
  const params = new URLSearchParams(search)
  return params.get('login') === 'success' || params.get('logout') === 'success'
}

// ── 5-3. 닫기·오늘 하루 보지 않기 저장(저장소는 인자로 받는다) ─────────────────────────────────────
export const NOTICE_POPUP_STORAGE_PREFIX = 'site-notice-popup:'
export const closedStorageKey = (sha: string) => `${NOTICE_POPUP_STORAGE_PREFIX}closed:${sha}`
export const hideTodayStorageKey = (sha: string) => `${NOTICE_POPUP_STORAGE_PREFIX}hide-today:${sha}`

const KST_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function kstDateString(nowMs: number) {
  return KST_DATE_FORMAT.format(new Date(nowMs))
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { readonly length: number }
// 저장소 객체를 꺼내는 함수. getter 가 던질 수 있으므로(사이트 데이터 차단) 함수로 받아 try 안에서 부른다.
export type StorageGetter = () => StorageLike | null | undefined

// 같은 탭 JS 수명 동안 닫은 지문(저장소가 실패해도 화면을 옮길 때 다시 뜨지 않게).
const memoryDismissed = new Set<string>()

export function resetNoticePopupMemory() {
  memoryDismissed.clear()
}

function safeGet(getStorage: StorageGetter, key: string) {
  try {
    const storage = getStorage()
    return storage ? storage.getItem(key) : null
  } catch {
    // 읽기 실패는 '저장 없음'으로 본다(팝업은 뜬다).
    return null
  }
}

function safeSet(getStorage: StorageGetter, key: string, value: string) {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeOtherKeys(getStorage: StorageGetter, keepSha: string) {
  try {
    const storage = getStorage()
    if (!storage) return
    const stale: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && key.startsWith(NOTICE_POPUP_STORAGE_PREFIX) && !key.endsWith(`:${keepSha}`)) {
        stale.push(key)
      }
    }
    stale.forEach((key) => storage.removeItem(key))
  } catch {
    // 지우지 못해도 동작에는 문제가 없다.
  }
}

export function isNoticePopupDismissed(
  sha: string,
  nowMs: number,
  storages: { session: StorageGetter; local: StorageGetter }
) {
  if (memoryDismissed.has(sha)) return true
  if (safeGet(storages.session, closedStorageKey(sha)) === '1') return true
  return safeGet(storages.local, hideTodayStorageKey(sha)) === kstDateString(nowMs)
}

// [닫기]·Esc·링크: 같은 탭 sessionStorage. 실패하면 메모리만.
export function markNoticePopupClosed(sha: string, storages: { session: StorageGetter }) {
  memoryDismissed.add(sha)
  safeSet(storages.session, closedStorageKey(sha), '1')
}

// [오늘 하루 보지 않기]: localStorage 에 한국 날짜. 다른 지문의 키는 지운다.
export function markNoticePopupHiddenToday(sha: string, nowMs: number, storages: { local: StorageGetter }) {
  memoryDismissed.add(sha)
  removeOtherKeys(storages.local, sha)
  safeSet(storages.local, hideTodayStorageKey(sha), kstDateString(nowMs))
}

// ── 4-2. 입력 검사(DB save_site_notice_popup 과 같은 규칙, 예시 묶음 tests/fixtures/bundle15-notice-input-examples.json) ──
export interface NoticePopupInput {
  enabled: boolean
  title: string
  body: string
  linkUrl: string | null
  linkLabel: string | null
  startsAt: string | null
  endsAt: string | null
}

const trimText = (value: string | null | undefined) => (value ?? '').replace(/\r\n?/g, '\n').trim()
const charLength = (value: string) => Array.from(value).length
// 링크에 제어문자가 들어가지 않게 막는 검사.
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

export function normalizeNoticePopupInput(input: NoticePopupInput): NoticePopupInput {
  const linkUrl = trimText(input.linkUrl)
  const linkLabel = trimText(input.linkLabel)
  return {
    enabled: input.enabled === true,
    title: trimText(input.title),
    body: trimText(input.body),
    linkUrl: linkUrl || null,
    linkLabel: linkLabel || null,
    startsAt: trimText(input.startsAt) || null,
    endsAt: trimText(input.endsAt) || null,
  }
}

export function isAllowedNoticeLink(linkUrl: string) {
  return linkUrl.startsWith('/')
    && !linkUrl.startsWith('//')
    && !linkUrl.startsWith('/\\')
    && !/\s/.test(linkUrl)
    && !CONTROL_PATTERN.test(linkUrl)
    && charLength(linkUrl) <= NOTICE_POPUP_LINK_MAX
}

// 잘못된 칸 이름을 돌려준다. 통과하면 null.
export function validateNoticePopupInput(raw: NoticePopupInput, nowMs: number): string | null {
  const input = normalizeNoticePopupInput(raw)
  if (!input.title || charLength(input.title) > NOTICE_POPUP_TITLE_MAX || input.title.includes('\n')) return 'title'
  if (!input.body || charLength(input.body) > NOTICE_POPUP_BODY_MAX) return 'body'
  if (input.linkUrl !== null && !isAllowedNoticeLink(input.linkUrl)) return 'linkUrl'
  if (input.linkUrl !== null && (!input.linkLabel || charLength(input.linkLabel) > NOTICE_POPUP_LINK_LABEL_MAX || input.linkLabel.includes('\n'))) {
    return 'linkLabel'
  }
  const startsAt = toMs(input.startsAt)
  const endsAt = toMs(input.endsAt)
  if ((input.startsAt && startsAt === null) || (input.endsAt && endsAt === null)) return 'date'
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) return 'endsAt'
  if (input.enabled && (endsAt === null || endsAt <= nowMs)) return 'endsAt'
  return null
}

// ── 4-3·7-2. '좋은 기록'(SQL policy_upcoming_notice_continuity 와 같은 규칙, 예시 묶음 tests/fixtures/bundle15-notice-record-examples.json) ──
export interface NoticeRecordAfter {
  enabled: boolean
  body: string
  linkUrl: string | null
  startsAt: string | null
  endsAt: string | null
}

// 깨는 조건(7-2 경고 다섯 가지와 같은 순서). 빈 배열이면 좋은 기록이다.
export type NoticeRecordProblem = 'disabled' | 'ends_before_effective' | 'starts_later' | 'link_not_upcoming' | 'body_missing_date'

export function getNoticeRecordProblems(
  after: NoticeRecordAfter,
  upcoming: { effectiveDate: string; effectiveDateLabel: string },
  savedAt: string | number | Date = Date.now()
): NoticeRecordProblem[] {
  const problems: NoticeRecordProblem[] = []
  if (after.enabled !== true) problems.push('disabled')
  const effectiveStart = toMs(`${upcoming.effectiveDate}T00:00:00+09:00`)
  const endsAt = toMs(after.endsAt)
  if (effectiveStart === null || endsAt === null || endsAt < effectiveStart) problems.push('ends_before_effective')
  const savedMs = savedAt instanceof Date ? savedAt.getTime() : typeof savedAt === 'number' ? savedAt : toMs(savedAt)
  const startsAt = toMs(after.startsAt)
  if (after.startsAt && (startsAt === null || savedMs === null || startsAt > savedMs)) problems.push('starts_later')
  // 링크는 글자까지 같아야 한다(#·쿼리·끝 / 가 붙어도 안 됨) — 5-1 의 '경로만 비교'와 다르다.
  if (after.linkUrl !== POLICY_UPCOMING_PATH) problems.push('link_not_upcoming')
  if (!upcoming.effectiveDateLabel || !after.body.includes(upcoming.effectiveDateLabel)) problems.push('body_missing_date')
  return problems
}

export function isNoticeRecordGood(
  after: NoticeRecordAfter,
  upcoming: { effectiveDate: string; effectiveDateLabel: string },
  savedAt: string | number | Date = Date.now()
) {
  return getNoticeRecordProblems(after, upcoming, savedAt).length === 0
}

// ── 관리자 카드: datetime-local(한국 시각) ↔ ISO ─────────────────────────────────────────────────
export function kstLocalInputToIso(local: string): string | null {
  const value = local.trim()
  if (!value) return null
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(withSeconds)) return null
  return `${withSeconds}+09:00`
}

export function isoToKstLocalInput(iso: string | null): string {
  const ms = toMs(iso)
  if (ms === null) return ''
  const kst = new Date(ms + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 16)
}

// 관리자 카드 '지금 상태' 판정
export type NoticePopupVisibility = 'visible' | 'off' | 'not_started' | 'ended'
export function getNoticePopupVisibility(value: Pick<SiteNoticePopupValue, 'enabled' | 'startsAt' | 'endsAt'>, nowMs: number): NoticePopupVisibility {
  if (!value.enabled) return 'off'
  const startsAt = toMs(value.startsAt)
  const endsAt = toMs(value.endsAt)
  if (endsAt === null || nowMs >= endsAt) return 'ended'
  if (startsAt !== null && nowMs < startsAt) return 'not_started'
  return 'visible'
}

export function extractNoticePopupErrorCode(message: string | null | undefined) {
  const text = message ?? ''
  if (text.includes(POLICY_UPCOMING_LOCKED_CODE)) return POLICY_UPCOMING_LOCKED_CODE
  const match = text.match(/\b(NOTICE_POPUP_[A-Z_]+)\b/)
  return match ? match[1] : null
}

// 7-3: 고지 기간 약관 문서·가입 동의 항목 저장이 트리거로 막혔을 때 보이는 안내.
export const POLICY_UPCOMING_LOCKED_MESSAGE =
  '변경 예정 약관을 고지하는 중이라 시행일까지 약관 문서(본문·이름·주소·켜기)를 바꿀 수 없습니다. 고쳐야 하면 고지를 다시 해야 합니다(런북).'

export function isPolicyUpcomingLockedMessage(message: string | null | undefined) {
  return (message ?? '').includes(POLICY_UPCOMING_LOCKED_CODE)
}
