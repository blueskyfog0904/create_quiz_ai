import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const MARKET_HOME_SETTING_KEY = 'market_home'
// 홈 진열 저장 때 회원 홈 캐시(preview-home-cache)를 바로 비우는 태그
export const MARKET_HOME_CACHE_TAG = 'market-home-config'

// 22번 홈 진열(계획 docs/plan-bundle22-home-merch.md 3-1). 종류·개수·길이는 코드 규칙, 제목·문구·순서·켜기·고른 상품은 DB(workspace_settings.market_home, 과목별 행).
export const MARKET_HOME_LIMITS = {
  popular: { min: 1, max: 24 },
  rankingWindowDays: { min: 1, max: 90 },
  recent: { min: 1, max: 24 },
  sections: { min: 1, max: 8 },
  featuredItems: { min: 0, max: 24 },
  title: { min: 1, max: 40 },
  emptyText: { min: 1, max: 80 },
  emptyHomeLink: { min: 1, max: 40 },
} as const

// 관리자가 새 섹션을 더할 때의 숫자 시작값(문구는 관리자가 적는다). 지금 인기 12·최근 8·기간 30일과 같다.
export const MARKET_HOME_NEW_SECTION_NUMBERS = {
  popularLimit: 12,
  rankingWindowDays: 30,
  recentLimit: 8,
} as const

export const MARKET_HOME_SECTION_KINDS = ['popular', 'recent', 'featured'] as const
export type MarketHomeSectionKind = (typeof MARKET_HOME_SECTION_KINDS)[number]
// 관리 화면 종류 이름(회원 화면에는 나오지 않는다)
export const MARKET_HOME_SECTION_KIND_LABELS: Record<MarketHomeSectionKind, string> = {
  popular: '인기 다운로드',
  recent: '최근 등록',
  featured: '추천 자료',
}
// 과목당 하나만 둘 수 있는 종류(추천은 여러 개)
export const MARKET_HOME_SINGLE_KINDS: readonly MarketHomeSectionKind[] = ['popular', 'recent']

interface MarketHomeSectionBase {
  id: string
  isActive: boolean
  title: string
  // 상품이 0개일 때 보일 문구. null 이면 섹션째 숨긴다(Q4).
  emptyText: string | null
}

export interface MarketHomePopularSection extends MarketHomeSectionBase {
  kind: 'popular'
  limit: number
  rankingWindowDays: number
}

export interface MarketHomeRecentSection extends MarketHomeSectionBase {
  kind: 'recent'
  limit: number
}

export interface MarketHomeFeaturedSection extends MarketHomeSectionBase {
  kind: 'featured'
  itemIds: string[]
}

export type MarketHomeSection = MarketHomePopularSection | MarketHomeRecentSection | MarketHomeFeaturedSection

// 관리자가 고치는 부분(판·revision 은 서버가 정한다)
export interface MarketHomeDraft {
  sections: MarketHomeSection[]
  // 보일 섹션과 배너가 모두 0개일 때 과목 문제마켓으로 가는 한 줄. null 이면 그리지 않는다.
  emptyHomeLink: string | null
}

export interface MarketHomeConfig extends MarketHomeDraft {
  version: 2
  revision: number
}

// 판 1(22번 전). 새 코드는 '설정 없음'으로 읽는다. 쓰이지 않는 campaign-hero.tsx 가 이 타입을 쓴다.
export interface MarketHomeConfigV1 {
  version: 1
  popular: {
    isActive: boolean
    limit: number
    rankingWindowDays: number
  }
  recent: {
    isActive: boolean
    limit: number
  }
}

export interface MarketHomeMenuEntry {
  id: string
  slug: string
  title: string
  description: string | null
  sortOrder: number
}

export interface MarketHomeItem {
  id: string
  title: string
  summary: string | null
  thumbnailUrl: string | null
  questionCount: number | null
  sourceType: string | null
  sources: Array<string | null>
  sample: {
    available: boolean
    pageCount: number
  }
  startingPriceCredits: number | null
  ratingAverage: number | null
  ratingCount: number
  publishedAt: string | null
  createdAt: string
}

export interface MarketHomePopularItem extends MarketHomeItem {
  downloadUserCount: number
}

// 회원 홈이 그리는 섹션(켜진 섹션만, 상품을 채운 것)
export type MarketHomeRenderedSection =
  | { id: string; kind: 'popular'; title: string; emptyText: string | null; items: MarketHomePopularItem[] }
  | { id: string; kind: 'recent'; title: string; emptyText: string | null; items: MarketHomeItem[] }
  | { id: string; kind: 'featured'; title: string; emptyText: string | null; items: MarketHomeItem[] }

// ok: 판 2 검사 통과 / missing: 판 1·행 없음 / invalid: 판 2 인데 구조 검사 실패(3-3). missing·invalid 는 섹션 0개.
export type MarketHomeConfigState = 'ok' | 'missing' | 'invalid'

export interface MarketHomeData {
  subject: WorkspaceSubject
  // error: 첫 채움부터 읽기 실패(page 가 '배너만'으로 그린다)
  state: MarketHomeConfigState | 'error'
  sections: MarketHomeRenderedSection[]
  emptyHomeLink: string | null
}

// 캐시 첫 채움부터 실패했을 때 page 가 쓰는 값: 섹션 없이 배너만(3-3)
export function marketHomeReadFailed(subject: WorkspaceSubject): MarketHomeData {
  return { subject, state: 'error', sections: [], emptyHomeLink: null }
}

export class MarketHomeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketHomeValidationError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new MarketHomeValidationError(message)
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
) {
  const allowed = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) fail(`${label}.${unexpected} 칸은 쓰지 않습니다.`)
  const missing = keys.find((key) => !(key in value))
  if (missing) fail(`${label}.${missing} 칸이 없습니다.`)
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${label} 값이 올바르지 않습니다.`)
}

function assertIntegerInRange(
  value: unknown,
  range: { min: number; max: number },
  label: string
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < range.min || (value as number) > range.max) {
    fail(`${label} 은(는) ${range.min}~${range.max} 사이 정수여야 합니다.`)
  }
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail(`${label} 형식이 올바르지 않습니다.`)
  return value.toLowerCase()
}

// 한 줄 글: 앞뒤 공백을 떼고 길이·제어 문자를 본다.
function readLine(value: unknown, range: { min: number; max: number }, label: string): string {
  if (typeof value !== 'string') fail(`${label} 은(는) 글이어야 합니다.`)
  const text = value.trim()
  if (text.length < range.min || text.length > range.max) fail(`${label} 은(는) ${range.min}~${range.max}자여야 합니다.`)
  if (CONTROL_CHARACTER_PATTERN.test(text)) fail(`${label} 에 줄바꿈·제어 문자를 넣을 수 없습니다.`)
  return text
}

function readOptionalLine(value: unknown, range: { min: number; max: number }, label: string): string | null {
  if (value === null) return null
  return readLine(value, range, label)
}

const BASE_KEYS = ['id', 'kind', 'isActive', 'title', 'emptyText'] as const

function validateSection(value: unknown, index: number): MarketHomeSection {
  const label = `sections[${index}]`
  if (!isRecord(value)) fail(`${label} 형식이 올바르지 않습니다.`)
  const id = assertUuid(value.id, `${label}.id`)
  assertBoolean(value.isActive, `${label}.isActive`)
  const title = readLine(value.title, MARKET_HOME_LIMITS.title, `${label}.title(제목)`)
  const emptyText = readOptionalLine(value.emptyText, MARKET_HOME_LIMITS.emptyText, `${label}.emptyText(빈 화면 문구)`)
  const base = { id, isActive: value.isActive, title, emptyText }

  if (value.kind === 'popular') {
    assertExactKeys(value, [...BASE_KEYS, 'limit', 'rankingWindowDays'], label)
    assertIntegerInRange(value.limit, MARKET_HOME_LIMITS.popular, `${label}.limit(개수)`)
    assertIntegerInRange(value.rankingWindowDays, MARKET_HOME_LIMITS.rankingWindowDays, `${label}.rankingWindowDays(집계 기간)`)
    return { ...base, kind: 'popular', limit: value.limit, rankingWindowDays: value.rankingWindowDays }
  }
  if (value.kind === 'recent') {
    assertExactKeys(value, [...BASE_KEYS, 'limit'], label)
    assertIntegerInRange(value.limit, MARKET_HOME_LIMITS.recent, `${label}.limit(개수)`)
    return { ...base, kind: 'recent', limit: value.limit }
  }
  if (value.kind === 'featured') {
    assertExactKeys(value, [...BASE_KEYS, 'itemIds'], label)
    if (!Array.isArray(value.itemIds)) fail(`${label}.itemIds 형식이 올바르지 않습니다.`)
    if (value.itemIds.length > MARKET_HOME_LIMITS.featuredItems.max) {
      fail(`추천 섹션 하나에는 상품을 ${MARKET_HOME_LIMITS.featuredItems.max}개까지 담을 수 있습니다.`)
    }
    const itemIds = value.itemIds.map((itemId, itemIndex) => assertUuid(itemId, `${label}.itemIds[${itemIndex}]`))
    if (new Set(itemIds).size !== itemIds.length) fail(`${label}: 같은 상품을 두 번 담을 수 없습니다.`)
    return { ...base, kind: 'featured', itemIds }
  }
  return fail(`${label}.kind 종류가 올바르지 않습니다.`)
}

function validateSections(value: unknown): MarketHomeSection[] {
  if (!Array.isArray(value)) fail('sections 형식이 올바르지 않습니다.')
  if (value.length < MARKET_HOME_LIMITS.sections.min || value.length > MARKET_HOME_LIMITS.sections.max) {
    fail(`섹션은 ${MARKET_HOME_LIMITS.sections.min}~${MARKET_HOME_LIMITS.sections.max}개여야 합니다.`)
  }
  const sections = value.map(validateSection)
  if (new Set(sections.map((section) => section.id)).size !== sections.length) fail('섹션 id 가 겹칩니다.')
  for (const kind of MARKET_HOME_SINGLE_KINDS) {
    if (sections.filter((section) => section.kind === kind).length > 1) fail(`${kind} 섹션은 과목당 하나만 둘 수 있습니다.`)
  }
  return sections
}

// 관리자 저장 입력(판·revision 없이). 구조 검사만 — 개인정보 모양 검사는 저장 route 가 따로 한다(3-1).
export function validateMarketHomeDraft(input: unknown): MarketHomeDraft {
  if (!isRecord(input)) fail('홈 진열 설정 형식이 올바르지 않습니다.')
  assertExactKeys(input, ['sections', 'emptyHomeLink'], 'config')
  return {
    sections: validateSections(input.sections),
    emptyHomeLink: readOptionalLine(input.emptyHomeLink, MARKET_HOME_LIMITS.emptyHomeLink, 'emptyHomeLink(빈 홈 링크 문구)'),
  }
}

// 저장된 판 2 값의 구조 검사(회원 홈 읽기도 이것만 쓴다 — 키·종류·개수·길이).
export function validateMarketHomeConfig(input: unknown): MarketHomeConfig {
  if (!isRecord(input)) fail('홈 진열 설정 형식이 올바르지 않습니다.')
  assertExactKeys(input, ['version', 'revision', 'sections', 'emptyHomeLink'], 'config')
  if (input.version !== 2) fail('config.version 은 2 여야 합니다.')
  if (!Number.isInteger(input.revision) || (input.revision as number) < 1) fail('config.revision 은 1 이상 정수여야 합니다.')
  const draft = validateMarketHomeDraft({ sections: input.sections, emptyHomeLink: input.emptyHomeLink })
  return { version: 2, revision: input.revision as number, ...draft }
}

export type MarketHomeConfigReadResult =
  | { state: 'ok'; config: MarketHomeConfig; revision: number }
  // 판 1·행 없음: revision 0(저장은 3-4 의 0 경로)
  | { state: 'missing'; config: null; revision: 0 }
  // 판 2 인데 구조 검사 실패: 저장된 revision(정수면)과 읽을 수 있는 섹션만
  | { state: 'invalid'; config: null; revision: number; readableSections: MarketHomeSection[]; emptyHomeLink: string | null }

// 저장된 값 → 상태(3-3·3-4). 판 1·행 없음은 '설정 없음'이고 기본값으로 돌아가지 않는다.
export function readMarketHomeConfig(value: unknown): MarketHomeConfigReadResult {
  if (!isRecord(value) || value.version !== 2) {
    return { state: 'missing', config: null, revision: 0 }
  }
  try {
    const config = validateMarketHomeConfig(value)
    return { state: 'ok', config, revision: config.revision }
  } catch {
    const revision = Number.isInteger(value.revision) && (value.revision as number) >= 1 ? value.revision as number : 0
    const readableSections: MarketHomeSection[] = []
    if (Array.isArray(value.sections)) {
      value.sections.forEach((section, index) => {
        try {
          const parsed = validateSection(section, index)
          const duplicate = readableSections.some((kept) => kept.id === parsed.id
            || (MARKET_HOME_SINGLE_KINDS.includes(parsed.kind) && kept.kind === parsed.kind))
          if (!duplicate && readableSections.length < MARKET_HOME_LIMITS.sections.max) readableSections.push(parsed)
        } catch {
          // 읽을 수 없는 섹션은 뺀다
        }
      })
    }
    let emptyHomeLink: string | null = null
    try {
      emptyHomeLink = readOptionalLine(value.emptyHomeLink, MARKET_HOME_LIMITS.emptyHomeLink, 'emptyHomeLink')
    } catch {
      emptyHomeLink = null
    }
    return { state: 'invalid', config: null, revision, readableSections, emptyHomeLink }
  }
}

// 섹션 제목 강조: 제목 안에서 **…** 로 감싼 부분을 회원 홈이 강조 색으로 그린다(이모지는 제목에 그대로 적는다).
// 짝이 맞지 않는 ** 는 글자 그대로 보인다 — 관리 화면 미리보기가 같은 규칙으로 보여 준다.
export interface MarketHomeTitlePart {
  text: string
  emphasis: boolean
}

export function splitMarketHomeTitle(title: string): MarketHomeTitlePart[] {
  const parts: MarketHomeTitlePart[] = []
  let last = 0
  for (const match of title.matchAll(/\*\*(.+?)\*\*/g)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ text: title.slice(last, start), emphasis: false })
    parts.push({ text: match[1], emphasis: true })
    last = start + match[0].length
  }
  if (last < title.length) parts.push({ text: title.slice(last), emphasis: false })
  return parts
}

// 강조 표시를 뺀 제목(확인 창·읽어 주는 이름처럼 색을 쓸 수 없는 곳)
export function plainMarketHomeTitle(title: string): string {
  return splitMarketHomeTitle(title).map((part) => part.text).join('')
}

// 회원 홈에 보일 섹션: 상품이 있으면 보이고, 0개면 빈 화면 문구가 있을 때만 보인다(Q4).
export function visibleMarketHomeSections(sections: MarketHomeRenderedSection[]): MarketHomeRenderedSection[] {
  return sections.filter((section) => section.items.length > 0 || Boolean(section.emptyText))
}

// 보일 섹션과 배너가 모두 0개일 때만 빈 홈 링크 한 줄을 보인다(3-3).
export function shouldShowEmptyHomeLink(data: Pick<MarketHomeData, 'sections' | 'emptyHomeLink'>, visibleBannerCount: number) {
  return Boolean(data.emptyHomeLink) && visibleBannerCount === 0 && visibleMarketHomeSections(data.sections).length === 0
}

// ---------------------------------------------------------------------------------------------------------------
// 관리 화면 편집 규칙(순수)
// ---------------------------------------------------------------------------------------------------------------

export function moveMarketHomeSection<T>(sections: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || index >= sections.length || target < 0 || target >= sections.length) return sections
  const next = [...sections]
  const moved = next[index]
  next[index] = next[target]
  next[target] = moved
  return next
}

// 이 종류를 더할 수 있는지(인기·최근은 하나만, 전체 8개까지)
export function canAddMarketHomeSection(sections: Pick<MarketHomeSection, 'kind'>[], kind: MarketHomeSectionKind) {
  if (sections.length >= MARKET_HOME_LIMITS.sections.max) return false
  return !(MARKET_HOME_SINGLE_KINDS.includes(kind) && sections.some((section) => section.kind === kind))
}

// 새 섹션(맨 아래, 꺼진 채로). 제목은 비워 두고 관리자가 적는다.
export function createMarketHomeSection(kind: MarketHomeSectionKind, id: string): MarketHomeSection {
  const base = { id, isActive: false, title: '', emptyText: null }
  if (kind === 'popular') {
    return { ...base, kind, limit: MARKET_HOME_NEW_SECTION_NUMBERS.popularLimit, rankingWindowDays: MARKET_HOME_NEW_SECTION_NUMBERS.rankingWindowDays }
  }
  if (kind === 'recent') return { ...base, kind, limit: MARKET_HOME_NEW_SECTION_NUMBERS.recentLimit }
  return { ...base, kind, itemIds: [] }
}

export function addMarketHomeSection(sections: MarketHomeSection[], kind: MarketHomeSectionKind, id: string): MarketHomeSection[] {
  if (!canAddMarketHomeSection(sections, kind)) return sections
  return [...sections, createMarketHomeSection(kind, id)]
}

// 추천 상품 순서 바꾸기·더하기·빼기
export function addFeaturedItem(itemIds: string[], itemId: string): string[] {
  const id = itemId.toLowerCase()
  if (itemIds.includes(id) || itemIds.length >= MARKET_HOME_LIMITS.featuredItems.max) return itemIds
  return [...itemIds, id]
}

export function removeFeaturedItem(itemIds: string[], itemId: string): string[] {
  return itemIds.filter((id) => id !== itemId)
}

// 추천 상품 거르기(3-2): 공개·활성·삭제 안 됨·같은 과목, 순서는 고른 순서. 빠진 상품은 이유와 함께.
export type MarketHomeFeaturedExclusionReason = 'not_found' | 'deleted' | 'other_subject' | 'not_published' | 'inactive'

export interface MarketHomeFeaturedCandidate {
  id: string
  workspace_subject: string
  status: string
  is_active: boolean
  deleted_at: string | null
}

export function filterFeaturedItems<Row extends MarketHomeFeaturedCandidate>(
  itemIds: string[],
  rows: Row[],
  subject: WorkspaceSubject
): { visible: Row[]; excluded: Array<{ id: string; reason: MarketHomeFeaturedExclusionReason; row: Row | null }> } {
  const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]))
  const visible: Row[] = []
  const excluded: Array<{ id: string; reason: MarketHomeFeaturedExclusionReason; row: Row | null }> = []
  for (const rawId of itemIds) {
    const id = rawId.toLowerCase()
    const row = byId.get(id) ?? null
    let reason: MarketHomeFeaturedExclusionReason | null = null
    if (!row) reason = 'not_found'
    else if (row.deleted_at) reason = 'deleted'
    else if (row.workspace_subject !== subject) reason = 'other_subject'
    else if (row.status !== 'published') reason = 'not_published'
    else if (!row.is_active) reason = 'inactive'
    if (reason) excluded.push({ id, reason, row })
    else if (row) visible.push(row)
  }
  return { visible, excluded }
}

export const MARKET_HOME_FEATURED_EXCLUSION_LABELS: Record<MarketHomeFeaturedExclusionReason, string> = {
  not_found: '없는 상품',
  deleted: '삭제됨',
  other_subject: '다른 과목',
  not_published: '공개 아님',
  inactive: '판매 꺼짐',
}

// 작업 기록용 차이(7절): 원문 없이 종류·켜기·제목 글자 수·상품 id 차이만.
type MarketHomeAuditValue = string | number | boolean | null | string[]

export function diffMarketHomeSections(before: MarketHomeSection[], after: MarketHomeSection[]) {
  const beforeById = new Map(before.map((section, index) => [section.id, { section, index }]))
  const afterIds = new Set(after.map((section) => section.id))
  const changes: Array<Record<string, MarketHomeAuditValue>> = []
  after.forEach((section, index) => {
    const found = beforeById.get(section.id)
    if (!found) {
      changes.push({ id: section.id, kind: section.kind, change: 'added', position: index, isActive: section.isActive, titleLength: section.title.length })
      return
    }
    const previous = found.section
    const fields: string[] = []
    if (found.index !== index) fields.push('position')
    if (previous.isActive !== section.isActive) fields.push('isActive')
    if (previous.title !== section.title) fields.push('title')
    if (previous.emptyText !== section.emptyText) fields.push('emptyText')
    if ('limit' in previous && 'limit' in section && previous.limit !== section.limit) fields.push('limit')
    if (previous.kind === 'popular' && section.kind === 'popular' && previous.rankingWindowDays !== section.rankingWindowDays) fields.push('rankingWindowDays')
    const change: Record<string, MarketHomeAuditValue> = {}
    if (previous.kind === 'featured' && section.kind === 'featured') {
      const addedItemIds = section.itemIds.filter((id) => !previous.itemIds.includes(id))
      const removedItemIds = previous.itemIds.filter((id) => !section.itemIds.includes(id))
      const orderChanged = previous.itemIds.filter((id) => section.itemIds.includes(id)).join()
        !== section.itemIds.filter((id) => previous.itemIds.includes(id)).join()
      if (addedItemIds.length > 0 || removedItemIds.length > 0 || orderChanged) {
        fields.push('itemIds')
        Object.assign(change, { addedItemIds, removedItemIds, itemOrderChanged: orderChanged, itemCount: section.itemIds.length })
      }
    }
    if (fields.length === 0) return
    changes.push({ id: section.id, kind: section.kind, change: 'updated', fields, position: index, isActive: section.isActive, titleLength: section.title.length, ...change })
  })
  for (const section of before) {
    if (!afterIds.has(section.id)) {
      changes.push({ id: section.id, kind: section.kind, change: 'removed', itemCount: section.kind === 'featured' ? section.itemIds.length : null })
    }
  }
  return changes
}
