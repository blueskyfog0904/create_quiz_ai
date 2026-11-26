import { isAllowedNoticeLink, linkPathOf } from '@/lib/site-notice-popup'

// 14번 계획(공지 게시판 + FAQ)의 순수 규칙. 서버·브라우저·시험이 같이 쓴다.
// 화면 문구·FAQ 분류·고정 상한은 DB(system_settings 'site_board_content')에 있다. 여기에는 종류 이름·글자 수 상한·링크 판정·필수 키·정렬 규칙과
// 관리자 오류 안내(코드 → 관리자 문구)만 둔다. 글자 수 상한·필수 키는 DB 함수(20261217140000)와 같다(계약 시험이 맞춰 본다).

export const SITE_BOARD_KINDS = ['notice', 'faq'] as const
export type SiteBoardKind = (typeof SITE_BOARD_KINDS)[number]

export const SITE_BOARD_CONTENT_SETTING_KEY = 'site_board_content'
export const SITE_BOARD_CONTENT_CACHE_TAG = 'site_board_content'
export const SITE_BOARD_POSTS_CACHE_TAG = 'site_board_posts'
// 회원 읽기 캐시의 시간 상한(초). 태그 갱신이 실패해도 이 시간 안에 내려간다.
export const SITE_BOARD_CACHE_SECONDS = 60

export const SITE_BOARD_TITLE_MAX = 100
export const SITE_BOARD_BODY_MAX = 20000
export const SITE_BOARD_LINK_MAX = 200
export const SITE_BOARD_LINK_LABEL_MAX = 30
export const SITE_BOARD_CONTENT_TEXT_MAX = 300
export const SITE_BOARD_REDACTED_TEXT_MAX = 100
export const SITE_BOARD_CATEGORY_LABEL_MAX = 30
export const SITE_BOARD_CATEGORY_COUNT_MAX = 20
export const SITE_BOARD_MAX_PINNED_MIN = 1
export const SITE_BOARD_MAX_PINNED_MAX = 20
export const SITE_BOARD_CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,29}$/
// 가림 사유는 정해진 코드만(자유 글 없음). DB redact_site_board_post 와 같은 목록.
export const SITE_BOARD_REDACT_REASON_CODES = ['pii', 'other'] as const
export type SiteBoardRedactReasonCode = (typeof SITE_BOARD_REDACT_REASON_CODES)[number]

// 필수 키(비지 않은 한 줄 글). DB save_site_board_content·VERIFY 와 같은 목록이고, 읽을 때도 이 목록으로 거른다(대표 세션 직접 수정 대비).
export const SITE_BOARD_REQUIRED_KEYS = {
  notice: ['pageTitle', 'pageDescription', 'emptyTitle', 'emptyDescription', 'pinnedLabel', 'updatedLabel',
    'backToListLabel', 'notFoundTitle', 'notFoundDescription', 'footerLinkLabel'],
  faq: ['pageTitle', 'pageDescription', 'emptyTitle', 'allCategoryLabel', 'supportPrompt', 'supportLinkLabel', 'footerLinkLabel'],
  footer: ['navLabel'],
} as const

type KeysOf<T extends readonly string[]> = T[number]
export type SiteBoardNoticeTexts = Record<KeysOf<typeof SITE_BOARD_REQUIRED_KEYS.notice>, string>
export type SiteBoardFaqTexts = Record<KeysOf<typeof SITE_BOARD_REQUIRED_KEYS.faq>, string>
export type SiteBoardFooterTexts = Record<KeysOf<typeof SITE_BOARD_REQUIRED_KEYS.footer>, string>

export interface SiteBoardFaqCategory {
  key: string
  label: string
}

export interface SiteBoardContent {
  revision: number
  notice: SiteBoardNoticeTexts & { maxPinned: number }
  faq: SiteBoardFaqTexts & { categories: SiteBoardFaqCategory[] }
  footer: SiteBoardFooterTexts
  redactedText: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const charLength = (value: string) => Array.from(value).length
const isOneLine = (value: string, max: number) => value.trim() !== '' && charLength(value.trim()) <= max && !/[\r\n]/.test(value)

function readTexts<K extends string>(raw: unknown, keys: readonly K[]): Record<K, string> | null {
  if (!isRecord(raw)) return null
  const out = {} as Record<K, string>
  for (const key of keys) {
    const value = raw[key]
    if (typeof value !== 'string' || !isOneLine(value, SITE_BOARD_CONTENT_TEXT_MAX)) return null
    out[key] = value.trim()
  }
  return out
}

function readCategories(raw: unknown): SiteBoardFaqCategory[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > SITE_BOARD_CATEGORY_COUNT_MAX) return null
  const seen = new Set<string>()
  const out: SiteBoardFaqCategory[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.key !== 'string' || typeof item.label !== 'string') return null
    if (!SITE_BOARD_CATEGORY_KEY_PATTERN.test(item.key) || seen.has(item.key) || !isOneLine(item.label, SITE_BOARD_CATEGORY_LABEL_MAX)) return null
    seen.add(item.key)
    out.push({ key: item.key, label: item.label.trim() })
  }
  return out
}

// 설정 행을 읽는다. 필수 키가 하나라도 비면 null(회원 화면은 기본 문구 없이 오류로 본다).
export function parseSiteBoardContent(raw: unknown): SiteBoardContent | null {
  if (!isRecord(raw) || !isRecord(raw.notice) || !isRecord(raw.faq)) return null
  const revision = raw.revision
  const maxPinned = raw.notice.maxPinned
  const notice = readTexts(raw.notice, SITE_BOARD_REQUIRED_KEYS.notice)
  const faq = readTexts(raw.faq, SITE_BOARD_REQUIRED_KEYS.faq)
  const footer = readTexts(raw.footer, SITE_BOARD_REQUIRED_KEYS.footer)
  const categories = readCategories(raw.faq.categories)
  if (typeof revision !== 'number' || !Number.isInteger(revision) || !notice || !faq || !footer || !categories) return null
  if (typeof maxPinned !== 'number' || !Number.isInteger(maxPinned) || maxPinned < SITE_BOARD_MAX_PINNED_MIN || maxPinned > SITE_BOARD_MAX_PINNED_MAX) return null
  if (typeof raw.redactedText !== 'string' || !isOneLine(raw.redactedText, SITE_BOARD_REDACTED_TEXT_MAX)) return null
  return {
    revision,
    notice: { ...notice, maxPinned },
    faq: { ...faq, categories },
    footer,
    redactedText: raw.redactedText.trim(),
  }
}

// 관리자 안내 문구 탭의 저장 전 검사(DB save_site_board_content 와 같은 순서). 잘못된 칸 이름을 돌려주고, 통과하면 null.
export function validateSiteBoardContentInput(value: Omit<SiteBoardContent, 'revision'>, pinnedCount: number): string | null {
  for (const key of SITE_BOARD_REQUIRED_KEYS.notice) if (!isOneLine(String(value.notice?.[key] ?? ''), SITE_BOARD_CONTENT_TEXT_MAX)) return `notice.${key}`
  for (const key of SITE_BOARD_REQUIRED_KEYS.faq) if (!isOneLine(String(value.faq?.[key] ?? ''), SITE_BOARD_CONTENT_TEXT_MAX)) return `faq.${key}`
  for (const key of SITE_BOARD_REQUIRED_KEYS.footer) if (!isOneLine(String(value.footer?.[key] ?? ''), SITE_BOARD_CONTENT_TEXT_MAX)) return `footer.${key}`
  if (!isOneLine(String(value.redactedText ?? ''), SITE_BOARD_REDACTED_TEXT_MAX)) return 'redactedText'
  if (!readCategories(value.faq?.categories)) return 'faq.categories'
  const maxPinned = value.notice?.maxPinned
  if (!Number.isInteger(maxPinned) || maxPinned < SITE_BOARD_MAX_PINNED_MIN || maxPinned > SITE_BOARD_MAX_PINNED_MAX || maxPinned < pinnedCount) {
    return 'notice.maxPinned'
  }
  return null
}

// ── 글 ─────────────────────────────────────────────────────────────────────────────────────────
export interface SiteBoardPost {
  id: string
  board: SiteBoardKind
  title: string
  body: string
  linkUrl: string | null
  linkLabel: string | null
  faqCategoryKey: string | null
  isPinned: boolean
  sortOrder: number
  isPublished: boolean
  publishedAt: string | null
  contentUpdatedAt: string | null
}

// 관리자 목록 행(숨김·가림 포함)
export interface SiteBoardAdminPost extends SiteBoardPost {
  revision: number
  deletedAt: string | null
  redactedAt: string | null
  updatedAt: string
  updatedBy: string | null
  updatedByLabel: string | null
}

export interface SiteBoardPostInput {
  title: string
  body: string
  linkUrl: string | null
  linkLabel: string | null
  faqCategoryKey: string | null
  isPinned: boolean
  isPublished: boolean
}

const trimText = (value: string | null | undefined) => (value ?? '').replace(/\r\n?/g, '\n').trim()

export function normalizeSiteBoardPostInput(input: SiteBoardPostInput): SiteBoardPostInput {
  const linkUrl = trimText(input.linkUrl) || null
  return {
    title: trimText(input.title),
    body: trimText(input.body),
    linkUrl,
    // 링크가 없으면 이름도 버린다(DB 와 같음).
    linkLabel: linkUrl ? trimText(input.linkLabel) || null : null,
    faqCategoryKey: trimText(input.faqCategoryKey) || null,
    isPinned: input.isPinned === true,
    isPublished: input.isPublished === true,
  }
}

// 링크는 사이트 안 경로만(15번 공지 팝업과 같은 규칙) + 제어문자를 퍼센트 인코딩한 것(%00-%1F·%7F)도 거절한다(DB 와 같음 —
// 개인정보 검사용 디코딩이 TS·DB 에서 같은 결과가 되게).
const ENCODED_CONTROL_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i

export function isAllowedSiteBoardLink(linkUrl: string) {
  return isAllowedNoticeLink(linkUrl) && charLength(linkUrl) <= SITE_BOARD_LINK_MAX && !ENCODED_CONTROL_PATTERN.test(linkUrl)
}

// 개인정보 검사용으로 링크의 퍼센트 인코딩을 푼다(DB save_site_board_post 와 같은 규칙): %XX(16진 2자리)는 바이트로,
// 나머지 글자는 UTF-8 그대로 이어 붙여 풀고, UTF-8 이 아니면 원문 그대로 돌려준다. 검사는 원문과 푼 값 둘 다 한다.
export function decodeSiteBoardLinkForPii(linkUrl: string): string {
  if (!linkUrl.includes('%')) return linkUrl
  const bytes: number[] = []
  const encoder = new TextEncoder()
  for (const match of linkUrl.matchAll(/(%[0-9A-Fa-f]{2})|([^%]+|%)/g)) {
    if (match[1]) bytes.push(Number.parseInt(match[1].slice(1), 16))
    else bytes.push(...encoder.encode(match[2]))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return linkUrl
  }
}

// 잘못된 칸 이름을 돌려준다(DB save_site_board_post 와 같은 순서). 통과하면 null.
export function validateSiteBoardPostInput(board: SiteBoardKind, raw: SiteBoardPostInput, categoryKeys: readonly string[]): string | null {
  const input = normalizeSiteBoardPostInput(raw)
  if (!input.title || charLength(input.title) > SITE_BOARD_TITLE_MAX || input.title.includes('\n')) return 'title'
  if (!input.body || charLength(input.body) > SITE_BOARD_BODY_MAX) return 'body'
  if (input.linkUrl !== null && !isAllowedSiteBoardLink(input.linkUrl)) return 'linkUrl'
  if (input.linkUrl !== null && (!input.linkLabel || charLength(input.linkLabel) > SITE_BOARD_LINK_LABEL_MAX || input.linkLabel.includes('\n'))) {
    return 'linkLabel'
  }
  if (board === 'faq') {
    if (!input.faqCategoryKey || !categoryKeys.includes(input.faqCategoryKey)) return 'faqCategoryKey'
    if (input.isPinned) return 'isPinned'
  } else if (input.faqCategoryKey !== null) {
    return 'faqCategoryKey'
  }
  return null
}

// ── 행위자 판정(DB site_board_actor_allowed 와 같은 식 — admin_role 이 빈 관리자는 거절, TS buildAdminAccess 보다 엄격) ─────────
export interface SiteBoardActorProfile {
  isAdmin: boolean | null
  adminRole: string | null
  withdrawn: boolean
}

export function siteBoardActorAllowed(profile: SiteBoardActorProfile | null, grantedPermissions: readonly string[]) {
  if (!profile || profile.isAdmin !== true || profile.withdrawn) return false
  if (profile.adminRole === 'owner') return true
  return profile.adminRole === 'staff' && grantedPermissions.includes('content.manage')
}

// ── 정렬 규칙(5-5) ───────────────────────────────────────────────────────────────────────────────
type SortablePost = Pick<SiteBoardPost, 'id' | 'isPinned' | 'sortOrder' | 'publishedAt' | 'faqCategoryKey'>

const byIdAsc = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const toMs = (value: string | null) => (value ? Date.parse(value) : Number.NEGATIVE_INFINITY)

// 공지: 고정 글을 sort_order, id 순으로 먼저, 그 뒤 비고정 글을 published_at DESC, id 순. 비고정 글에는 sort_order 를 쓰지 않는다.
export function sortNoticePosts<T extends SortablePost>(posts: readonly T[]): T[] {
  const pinned = posts.filter((post) => post.isPinned).sort((a, b) => a.sortOrder - b.sortOrder || byIdAsc(a, b))
  const rest = posts.filter((post) => !post.isPinned).sort((a, b) => toMs(b.publishedAt) - toMs(a.publishedAt) || byIdAsc(a, b))
  return [...pinned, ...rest]
}

// FAQ: 설정 categories 배열 순서 → 분류 안 sort_order, id. 설정에 없는 분류의 글은 뺀다.
export function groupFaqPosts<T extends SortablePost>(posts: readonly T[], categories: readonly SiteBoardFaqCategory[]) {
  return categories
    .map((category) => ({
      category,
      posts: posts
        .filter((post) => post.faqCategoryKey === category.key)
        .sort((a, b) => a.sortOrder - b.sortOrder || byIdAsc(a, b)),
    }))
}

export function sortFaqPosts<T extends SortablePost>(posts: readonly T[], categories: readonly SiteBoardFaqCategory[]): T[] {
  return groupFaqPosts(posts, categories).flatMap((group) => group.posts)
}

// ── 주소·팝업 연결 ─────────────────────────────────────────────────────────────────────────────────
export const NOTICE_LIST_PATH = '/notices'
export const FAQ_PATH = '/faq'
export const SUPPORT_PATH = '/mypage/support'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isSiteBoardPostId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function noticePath(id: string) {
  return `${NOTICE_LIST_PATH}/${id}`
}

// 팝업 링크(쿼리·#·끝 / 를 뗀 경로)가 공지 상세면 그 글 id(소문자). 글자 비교만 하지 않는다(7-3).
export function noticeIdFromPopupLink(linkUrl: string | null | undefined): string | null {
  const path = linkPathOf(linkUrl)
  const match = path?.match(/^\/notices\/([^/]+)$/)
  return match && isSiteBoardPostId(match[1]) ? match[1].toLowerCase() : null
}

// 같은 화면 안 FAQ 질문 링크(/faq#id)면 그 id(소문자), 아니면 null. next/link 는 해시만 바뀌는 이동을 pushState 로 처리해
// hashchange 가 일어나지 않으므로, FAQ 화면이 클릭을 먼저 받아 펼친다(8절). 주소는 지금 주소(origin)를 기준으로 푼다.
export function sameFaqPageHashId(href: string, currentHref: string): string | null {
  let target: URL
  let current: URL
  try {
    target = new URL(href, currentHref)
    current = new URL(currentHref)
  } catch {
    return null
  }
  const path = target.pathname.replace(/\/+$/, '') || '/'
  if (target.origin !== current.origin || path !== FAQ_PATH || target.hash.length < 2) return null
  try {
    return decodeURIComponent(target.hash.slice(1)).toLowerCase()
  } catch {
    return null
  }
}

// ── 오류 코드 → 관리자 문구(관리자 안내라 코드 글자) ───────────────────────────────────────────────────
export const SITE_BOARD_ERROR_MESSAGES = {
  SITE_BOARD_ACTOR_NOT_ALLOWED: '이 작업을 할 권한이 없습니다.',
  SITE_BOARD_INPUT_INVALID: '입력값을 확인해 주세요.',
  SITE_BOARD_POST_NOT_FOUND: '글을 찾을 수 없습니다. 화면을 새로고침해 주세요.',
  SITE_BOARD_POST_DELETED: '삭제했거나 가린 글이라 고칠 수 없습니다.',
  SITE_BOARD_REVISION_CONFLICT: '그 사이 다른 곳에서 바뀌었습니다. 최신 내용을 다시 불러왔으니 글을 다시 열어 확인한 뒤 저장하세요.',
  SITE_BOARD_PII_SUSPECTED: '개인정보로 보이는 글이 있어 저장하지 않았습니다. 고객센터 연락처 말고는 이메일·전화번호·주민번호를 적지 마세요.',
  SITE_BOARD_PIN_LIMIT: '고정할 수 있는 공지 수를 넘습니다. 다른 고정을 먼저 풀어 주세요(숨긴 고정 글도 셉니다).',
  SITE_BOARD_REORDER_MISMATCH: '그 사이 목록이 바뀌었습니다. 다시 불러온 순서를 확인한 뒤 다시 저장하세요.',
  SITE_BOARD_REDACT_PUBLISHED: '게시 중인 글은 가릴 수 없습니다. 먼저 숨기거나 삭제하세요.',
  SITE_BOARD_CATEGORY_IN_USE: '글이 남은 분류는 지울 수 없습니다(숨긴 글 포함). 글을 옮기거나 삭제한 뒤 지우세요.',
  SITE_BOARD_CONTENT_MISSING: '공지·FAQ 설정이 없습니다. DB 적용 상태를 확인해 주세요.',
  SITE_BOARD_REVISIONS_APPEND_ONLY: '판 이력은 고칠 수 없습니다.',
} as const

export type SiteBoardErrorCode = keyof typeof SITE_BOARD_ERROR_MESSAGES

export const SITE_BOARD_FIELD_LABELS: Record<string, string> = {
  title: '제목',
  body: '본문',
  linkUrl: '링크 주소(/로 시작하는 사이트 안 주소)',
  linkLabel: '링크 이름',
  faqCategoryKey: '분류',
  isPinned: '고정',
  board: '게시판',
  revision: '판',
  request: '요청 정보',
  scope: '순서 범위',
  ids: '순서 목록',
  id: '글',
  reasonCode: '가림 사유',
  value: '안내 문구',
  redactedText: '가림 문구(한 줄, 100자 이하)',
  'faq.categories': 'FAQ 분류(1~20개, key 는 영문 소문자로 시작)',
  'notice.maxPinned': '고정 상한(1~20, 지금 고정된 글 수 이상)',
}

export function extractSiteBoardError(message: string | null | undefined): { code: SiteBoardErrorCode; detail: string | null } | null {
  const match = /(SITE_BOARD_[A-Z_]+)(?::([A-Za-z0-9_.,]+))?/.exec(message ?? '')
  if (!match || !(match[1] in SITE_BOARD_ERROR_MESSAGES)) return null
  return { code: match[1] as SiteBoardErrorCode, detail: match[2] ?? null }
}

export function siteBoardErrorMessage(error: { code: SiteBoardErrorCode; detail: string | null }, piiLabels?: Record<string, string>) {
  const base: string = SITE_BOARD_ERROR_MESSAGES[error.code]
  if (!error.detail) return base
  if (error.code === 'SITE_BOARD_INPUT_INVALID') {
    const field = SITE_BOARD_FIELD_LABELS[error.detail] ?? error.detail
    return `${base} (${field})`
  }
  if (error.code === 'SITE_BOARD_PII_SUSPECTED') {
    const kinds = error.detail.split(',').map((kind) => piiLabels?.[kind] ?? kind)
    return `${base} (${kinds.join(', ')})`
  }
  if (error.code === 'SITE_BOARD_CATEGORY_IN_USE') return `${base} (${error.detail})`
  return base
}
