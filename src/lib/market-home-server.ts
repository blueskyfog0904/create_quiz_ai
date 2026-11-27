import { createAdminClient } from '@/lib/supabase/bypass'
import { loadMarketItemListEnrichment } from '@/lib/market-item-list-enrichment'
import {
  MARKET_HOME_LIMITS,
  MARKET_HOME_NEW_SECTION_NUMBERS,
  MARKET_HOME_SETTING_KEY,
  filterFeaturedItems,
  readMarketHomeConfig,
  type MarketHomeConfig,
  type MarketHomeConfigReadResult,
  type MarketHomeConfigState,
  type MarketHomeData,
  type MarketHomeDraft,
  type MarketHomeFeaturedExclusionReason,
  type MarketHomeItem,
  type MarketHomePopularItem,
  type MarketHomePopularSection,
  type MarketHomeRenderedSection,
  type MarketHomeSection,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import type { Json } from '@/types/supabase'
import {
  MARKET_THUMBNAIL_EMBED,
  toMarketThumbnailUrl,
  type MarketPublicUrlClient,
  type MarketThumbnailSource,
} from '@/lib/market-images'

const ITEM_SELECT = `id, title, summary, question_count, source_type, source_1, source_2, source_3, source_4, pdf_price, hwp_price, zip_price, published_at, created_at, ${MARKET_THUMBNAIL_EMBED}`
// 추천 거르기는 상태 칸까지 읽는다(공개·활성·삭제·과목을 코드가 나눠 이유를 붙인다).
const FEATURED_SELECT = `${ITEM_SELECT}, workspace_subject, status, is_active, deleted_at`

type ItemRow = MarketThumbnailSource & {
  id: string
  title: string
  summary: string | null
  question_count: number | null
  source_type: string | null
  source_1: string | null
  source_2: string | null
  source_3: string | null
  source_4: string | null
  pdf_price: number
  hwp_price: number
  zip_price: number
  published_at: string | null
  created_at: string
}

type FeaturedRow = ItemRow & {
  workspace_subject: string
  status: string
  is_active: boolean
  deleted_at: string | null
}

type PopularRow = {
  item_id: string
  download_issuer_user_count: number
}

type AdminClient = ReturnType<typeof createAdminClient>

function getAdminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createAdminClient()
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim().normalize('NFC')
  return normalized || null
}

// 노출은 상품 상태만으로 정한다(게시판 무관). 조회 결과의 공개 상품은 모두 카드로 만든다.
function toItem(
  client: MarketPublicUrlClient,
  row: ItemRow,
  enrichment: Awaited<ReturnType<typeof loadMarketItemListEnrichment>>
): MarketHomeItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    thumbnailUrl: toMarketThumbnailUrl(client, row),
    questionCount: row.question_count,
    sourceType: normalizeText(row.source_type),
    sources: [row.source_1, row.source_2, row.source_3, row.source_4].map(normalizeText),
    sample: {
      available: (enrichment.sampleCounts.get(row.id) ?? 0) > 0,
      pageCount: enrichment.sampleCounts.get(row.id) ?? 0,
    },
    startingPriceCredits: enrichment.startingPrices.get(row.id) ?? null,
    ratingAverage: enrichment.ratingSummaries.get(row.id)?.average ?? null,
    ratingCount: enrichment.ratingSummaries.get(row.id)?.count ?? 0,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }
}

async function toItems(supabase: AdminClient, workspaceSubject: WorkspaceSubject, rows: ItemRow[]) {
  const enrichment = await loadMarketItemListEnrichment(
    supabase,
    workspaceSubject,
    rows.map((row) => ({
      id: row.id,
      pdfPrice: row.pdf_price,
      hwpPrice: row.hwp_price,
      zipPrice: row.zip_price,
    }))
  )
  return rows.map((row) => toItem(supabase, row, enrichment))
}

// 저장된 행을 읽는다. 읽기 오류는 던진다(회원 홈 캐시가 이전 정상 값을 유지하도록, 3-3).
async function loadConfigRow(supabase: AdminClient, workspaceSubject: WorkspaceSubject): Promise<{ exists: boolean; value: unknown }> {
  const { data, error } = await supabase
    .from('workspace_settings')
    .select('value')
    .eq('workspace_subject', workspaceSubject)
    .eq('setting_key', MARKET_HOME_SETTING_KEY)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return { exists: Boolean(data), value: data?.value ?? null }
}

async function loadRecent(
  supabase: AdminClient,
  workspaceSubject: WorkspaceSubject,
  limit: number
): Promise<MarketHomeItem[]> {
  const { data, error } = await supabase
    .from('market_items')
    .select(ITEM_SELECT)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  return toItems(supabase, workspaceSubject, data as ItemRow[])
}

async function loadPopular(
  supabase: AdminClient,
  workspaceSubject: WorkspaceSubject,
  section: Pick<MarketHomePopularSection, 'limit' | 'rankingWindowDays'>
): Promise<MarketHomePopularItem[]> {
  const { data, error } = await supabase.rpc('get_market_home_popular_items', {
    p_workspace_subject: workspaceSubject,
    p_from: new Date(Date.now() - section.rankingWindowDays * 86_400_000).toISOString(),
    p_limit: section.limit,
  })
  if (error) throw new Error(error.message)

  const rankings = (data ?? []) as PopularRow[]
  if (rankings.length === 0) return []

  const { data: itemData, error: itemError } = await supabase
    .from('market_items')
    .select(ITEM_SELECT)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('id', rankings.map((row) => row.item_id))
  if (itemError) throw new Error(itemError.message)

  const items = await toItems(supabase, workspaceSubject, itemData as ItemRow[])
  const itemsById = new Map(items.map((item) => [item.id, item] as const))
  return rankings.flatMap((row) => {
    const item = itemsById.get(row.item_id)
    return item
      ? [{ ...item, downloadUserCount: Number(row.download_issuer_user_count) }]
      : []
  })
}

export interface MarketHomeFeaturedPreview {
  items: MarketHomeItem[]
  excluded: Array<{ id: string; reason: MarketHomeFeaturedExclusionReason; title: string | null }>
}

// 추천 섹션(3-2): 고른 순서대로, 공개·활성·삭제 안 됨·같은 과목만. 빠진 상품은 이유와 함께(관리 화면용).
async function loadFeatured(
  supabase: AdminClient,
  workspaceSubject: WorkspaceSubject,
  itemIds: string[]
): Promise<MarketHomeFeaturedPreview> {
  if (itemIds.length === 0) return { items: [], excluded: [] }
  const { data, error } = await supabase
    .from('market_items')
    .select(FEATURED_SELECT)
    .in('id', itemIds)
  if (error) throw new Error(error.message)

  const { visible, excluded } = filterFeaturedItems(itemIds, (data ?? []) as unknown as FeaturedRow[], workspaceSubject)
  return {
    items: await toItems(supabase, workspaceSubject, visible),
    excluded: excluded.map((entry) => ({ id: entry.id, reason: entry.reason, title: entry.row?.title ?? null })),
  }
}

async function renderSection(
  supabase: AdminClient,
  workspaceSubject: WorkspaceSubject,
  section: MarketHomeSection
): Promise<MarketHomeRenderedSection> {
  const base = { id: section.id, title: section.title, emptyText: section.emptyText }
  if (section.kind === 'popular') {
    return { ...base, kind: 'popular', items: await loadPopular(supabase, workspaceSubject, section) }
  }
  if (section.kind === 'recent') {
    return { ...base, kind: 'recent', items: await loadRecent(supabase, workspaceSubject, section.limit) }
  }
  return { ...base, kind: 'featured', items: (await loadFeatured(supabase, workspaceSubject, section.itemIds)).items }
}

// 회원 홈 데이터(3-3). 캐시(preview-home-cache)가 감싼다.
// - 읽기 오류는 던진다: unstable_cache 가 이전 정상 값을 유지하고, 첫 채움부터 실패하면 page 가 '배너만'으로 그린다.
// - 판 1·행 없음·판 2 검사 실패: 섹션 0개(기본 문구로 돌아가지 않음) + 서버 로그. 관리 화면에는 빨간 띠.
// - 꺼진 섹션은 읽지 않는다.
export async function getMarketHomeData(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeData> {
  const supabase = getAdminClient()
  if (!supabase) return { subject: workspaceSubject, state: 'missing', sections: [], emptyHomeLink: null }

  const read = readMarketHomeConfig((await loadConfigRow(supabase, workspaceSubject)).value)
  if (read.state !== 'ok') {
    console.error('[market-home] 회원 홈 설정이 없거나 형식이 다릅니다. 섹션 없이 그립니다.', { subject: workspaceSubject, state: read.state })
    return { subject: workspaceSubject, state: read.state, sections: [], emptyHomeLink: null }
  }

  const sections = await Promise.all(
    read.config.sections
      .filter((section) => section.isActive)
      .map((section) => renderSection(supabase, workspaceSubject, section))
  )
  return { subject: workspaceSubject, state: 'ok', sections, emptyHomeLink: read.config.emptyHomeLink }
}

// 관리 화면 미리보기(3-2): 추천 상품 카드와 빠진 이유.
export async function getMarketHomeFeaturedPreview(
  workspaceSubject: WorkspaceSubject,
  itemIds: string[]
): Promise<MarketHomeFeaturedPreview> {
  const supabase = getAdminClient()
  if (!supabase) throw new Error('홈 진열 미리보기에 필요한 서비스 역할 키가 없습니다.')
  return loadFeatured(supabase, workspaceSubject, itemIds)
}

export interface MarketHomeItemSearchResult {
  id: string
  title: string
  status: string
  isActive: boolean
  deleted: boolean
  thumbnailUrl: string | null
}

const ITEM_SEARCH_LIMIT = 20
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 관리 화면 상품 고르기(3-2): 같은 과목 상품을 제목(또는 id)으로 찾는다. 상태와 대표 그림만 준다(회원 정보 없음).
export async function searchMarketHomeItems(
  workspaceSubject: WorkspaceSubject,
  query: string
): Promise<MarketHomeItemSearchResult[]> {
  const supabase = getAdminClient()
  if (!supabase) throw new Error('상품 검색에 필요한 서비스 역할 키가 없습니다.')
  // PostgREST 는 like 값의 * 를 % 로 바꾸므로 검색어에서 뺀다(%·_·\ 는 아래에서 이스케이프)
  const text = query.replace(/\*/g, '').trim().slice(0, 100)
  let request = supabase
    .from('market_items')
    .select(`id, title, status, is_active, deleted_at, ${MARKET_THUMBNAIL_EMBED}`)
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
  if (UUID_TEXT.test(text)) request = request.eq('id', text.toLowerCase())
  else if (text) request = request.ilike('title', `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
  const { data, error } = await request
    .order('updated_at', { ascending: false })
    .limit(ITEM_SEARCH_LIMIT)
  if (error) throw new Error(error.message)

  type SearchRow = MarketThumbnailSource & { id: string; title: string; status: string; is_active: boolean; deleted_at: string | null }
  return ((data ?? []) as unknown as SearchRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    isActive: row.is_active,
    deleted: Boolean(row.deleted_at),
    thumbnailUrl: toMarketThumbnailUrl(supabase, row),
  }))
}

export interface MarketHomeAdminData {
  state: MarketHomeConfigState
  // 동시 저장 막기(3-4). 판 1·행 없음이면 0.
  revision: number
  // 편집 시작값: 정상이면 저장된 값, 형식 오류면 읽을 수 있는 섹션만, 설정 없음이면 빈 시작값.
  draft: MarketHomeDraft
  // 미리보기 재료(3-2): 인기·최근을 상한 24개까지 미리 읽고 화면이 저장 전 개수만큼 자른다.
  pool: {
    popular: MarketHomePopularItem[]
    recent: MarketHomeItem[]
    // 인기 미리보기가 쓴 집계 기간(이 값과 다르게 고치면 '저장 뒤 반영')
    rankingWindowDays: number
    error: boolean
  }
  // 추천 섹션별 미리보기(저장된 값 기준). 바꾸면 화면이 preview-items route 로 다시 읽는다.
  featured: Record<string, MarketHomeFeaturedPreview>
}

function adminDraft(read: MarketHomeConfigReadResult): MarketHomeDraft {
  if (read.state === 'ok') return { sections: read.config.sections, emptyHomeLink: read.config.emptyHomeLink }
  if (read.state === 'invalid') return { sections: read.readableSections, emptyHomeLink: read.emptyHomeLink }
  return { sections: [], emptyHomeLink: null }
}

export async function getMarketHomeAdminData(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeAdminData> {
  const supabase = getAdminClient()
  if (!supabase) throw new Error('홈 진열 설정을 읽는 데 필요한 서비스 역할 키가 없습니다.')

  const read = readMarketHomeConfig((await loadConfigRow(supabase, workspaceSubject)).value)
  const draft = adminDraft(read)
  const savedPopular = draft.sections.find((section): section is MarketHomePopularSection => section.kind === 'popular')
  const rankingWindowDays = savedPopular?.rankingWindowDays ?? MARKET_HOME_NEW_SECTION_NUMBERS.rankingWindowDays

  const [poolResult, featuredResults] = await Promise.all([
    Promise.all([
      loadPopular(supabase, workspaceSubject, { limit: MARKET_HOME_LIMITS.popular.max, rankingWindowDays }),
      loadRecent(supabase, workspaceSubject, MARKET_HOME_LIMITS.recent.max),
    ]).then((value) => ({ ok: true as const, value }), (error: unknown) => {
      console.error('[market-home] 관리 화면 미리보기 상품을 읽지 못했습니다.', error instanceof Error ? error.message : error)
      return { ok: false as const }
    }),
    Promise.all(draft.sections.flatMap((section) => (section.kind === 'featured'
      ? [loadFeatured(supabase, workspaceSubject, section.itemIds)
        .then((preview) => [section.id, preview] as const, () => [section.id, { items: [], excluded: [] }] as const)]
      : []))),
  ])

  return {
    state: read.state,
    revision: read.revision,
    draft,
    pool: poolResult.ok
      ? { popular: poolResult.value[0], recent: poolResult.value[1], rankingWindowDays, error: false }
      : { popular: [], recent: [], rankingWindowDays, error: true },
    featured: Object.fromEntries(featuredResults),
  }
}

export class MarketHomeRevisionConflictError extends Error {
  constructor() {
    super('다른 관리자가 먼저 저장했습니다. 다시 불러오세요.')
    this.name = 'MarketHomeRevisionConflictError'
  }
}

export interface MarketHomeSaveResult {
  config: MarketHomeConfig
  previousRevision: number
  // 이전 판 2 섹션(작업 기록 차이용). 설정 없음·형식 오류였으면 빈 배열.
  previousSections: MarketHomeSection[]
}

// 조건부 저장(3-4). 새 revision 은 서버가 정한다.
// - 받은 값 ≥ 1: 판 2 이고 revision 이 받은 값인 행만 고친다 → revision + 1
// - 받은 값 = 0, 행 없음: INSERT … ON CONFLICT DO NOTHING → revision 1
// - 받은 값 = 0, 행이 판 2 아님(판 1 등): 판이 2 가 아닌 행만 고친다 → revision 1
// - 고친 행이 0 이면 MarketHomeRevisionConflictError(409)
export async function saveMarketHomeConfig(input: {
  workspaceSubject: WorkspaceSubject
  expectedRevision: number
  draft: MarketHomeDraft
  actorId: string
}): Promise<MarketHomeSaveResult> {
  const supabase = getAdminClient()
  if (!supabase) throw new Error('홈 진열 저장에 필요한 서비스 역할 키가 없습니다.')

  const current = await loadConfigRow(supabase, input.workspaceSubject)
  const previous = readMarketHomeConfig(current.value)
  const config: MarketHomeConfig = {
    version: 2,
    revision: input.expectedRevision + 1,
    sections: input.draft.sections,
    emptyHomeLink: input.draft.emptyHomeLink,
  }
  const row = {
    value: config as unknown as Json,
    description: '문제마켓 홈 진열(22번 판 2)',
    updated_by: input.actorId,
    updated_at: new Date().toISOString(),
  }

  let saved: unknown[] | null = null
  if (input.expectedRevision >= 1) {
    const { data, error } = await supabase
      .from('workspace_settings')
      .update(row)
      .eq('workspace_subject', input.workspaceSubject)
      .eq('setting_key', MARKET_HOME_SETTING_KEY)
      .eq('value->>version', '2')
      .eq('value->>revision', String(input.expectedRevision))
      .select('id')
    if (error) throw new Error(error.message)
    saved = data
  } else if (!current.exists) {
    const { data, error } = await supabase
      .from('workspace_settings')
      .upsert(
        { ...row, workspace_subject: input.workspaceSubject, setting_key: MARKET_HOME_SETTING_KEY },
        { onConflict: 'workspace_subject,setting_key', ignoreDuplicates: true }
      )
      .select('id')
    if (error) throw new Error(error.message)
    saved = data
  } else {
    // 판 칸이 있으면 '2 가 아님', 없으면(판 칸 없음·객체 아님) 'NULL' 로 본다. 그사이 바뀌었으면 0행 → 409.
    const storedVersion = typeof current.value === 'object' && current.value !== null && !Array.isArray(current.value)
      ? (current.value as Record<string, unknown>).version
      : undefined
    let request = supabase
      .from('workspace_settings')
      .update(row)
      .eq('workspace_subject', input.workspaceSubject)
      .eq('setting_key', MARKET_HOME_SETTING_KEY)
    request = storedVersion === undefined || storedVersion === null
      ? request.is('value->>version', null)
      : request.neq('value->>version', '2')
    const { data, error } = await request.select('id')
    if (error) throw new Error(error.message)
    saved = data
  }

  if (!saved || saved.length === 0) throw new MarketHomeRevisionConflictError()
  return {
    config,
    previousRevision: input.expectedRevision,
    previousSections: previous.state === 'ok' ? previous.config.sections : [],
  }
}
