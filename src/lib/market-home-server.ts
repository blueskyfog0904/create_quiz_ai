import { createAdminClient } from '@/lib/supabase/bypass'
import { loadMarketItemListEnrichment } from '@/lib/market-item-list-enrichment'
import {
  DEFAULT_MARKET_HOME_CONFIG,
  MARKET_HOME_SETTING_KEY,
  normalizeMarketHomeConfig,
  type MarketHomeConfig,
  type MarketHomeData,
  type MarketHomeItem,
  type MarketHomePopularItem,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  MARKET_THUMBNAIL_EMBED,
  toMarketThumbnailUrl,
  type MarketPublicUrlClient,
  type MarketThumbnailSource,
} from '@/lib/market-images'

const ITEM_SELECT = `id, title, summary, menu_entry_id, question_count, source_type, source_1, source_2, source_3, source_4, pdf_price, hwp_price, zip_price, published_at, created_at, ${MARKET_THUMBNAIL_EMBED}`

type ItemRow = MarketThumbnailSource & {
  id: string
  title: string
  summary: string | null
  menu_entry_id: string
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

type PopularRow = {
  item_id: string
  download_issuer_user_count: number
}

export interface MarketHomeAdminData {
  config: MarketHomeConfig
  preview: MarketHomeData
}

const EMPTY_HOME_DATA = {
  popular: [],
  recent: [],
} as const

function getAdminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createAdminClient()
}

function fulfilledOr<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback
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
    menuEntryId: row.menu_entry_id,
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

async function loadConfig(workspaceSubject: WorkspaceSubject): Promise<MarketHomeConfig> {
  const supabase = getAdminClient()
  if (!supabase) return normalizeMarketHomeConfig(DEFAULT_MARKET_HOME_CONFIG)

  const { data, error } = await supabase
    .from('workspace_settings')
    .select('value')
    .eq('workspace_subject', workspaceSubject)
    .eq('setting_key', MARKET_HOME_SETTING_KEY)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return normalizeMarketHomeConfig(data?.value)
}

async function loadRecent(
  workspaceSubject: WorkspaceSubject,
  limit: number
): Promise<MarketHomeItem[]> {
  const supabase = getAdminClient()
  if (!supabase) return []

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
  const rows = data as ItemRow[]
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

async function loadPopular(
  workspaceSubject: WorkspaceSubject,
  config: MarketHomeConfig['popular']
): Promise<MarketHomePopularItem[]> {
  const supabase = getAdminClient()
  if (!supabase || !config.isActive) return []

  const { data, error } = await supabase.rpc('get_market_home_popular_items', {
    p_workspace_subject: workspaceSubject,
    p_from: new Date(Date.now() - config.rankingWindowDays * 86_400_000).toISOString(),
    p_limit: config.limit,
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

  const itemRows = itemData as ItemRow[]
  const enrichment = await loadMarketItemListEnrichment(
    supabase,
    workspaceSubject,
    itemRows.map((row) => ({
      id: row.id,
      pdfPrice: row.pdf_price,
      hwpPrice: row.hwp_price,
      zipPrice: row.zip_price,
    }))
  )
  const itemsById = new Map(itemRows.map((row) => [row.id, toItem(supabase, row, enrichment)] as const))
  return rankings.flatMap((row) => {
    const item = itemsById.get(row.item_id)
    return item
      ? [{ ...item, downloadUserCount: Number(row.download_issuer_user_count) }]
      : []
  })
}

async function countPublicItems(workspaceSubject: WorkspaceSubject): Promise<number> {
  const supabase = getAdminClient()
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('market_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function getMarketHomeData(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeData> {
  const config = await loadConfig(workspaceSubject)
    .catch(() => normalizeMarketHomeConfig(DEFAULT_MARKET_HOME_CONFIG))

  const [popularResult, recentResult, countResult] = await Promise.allSettled([
    loadPopular(workspaceSubject, config.popular),
    config.recent.isActive
      ? loadRecent(workspaceSubject, config.recent.limit)
      : Promise.resolve([]),
    countPublicItems(workspaceSubject),
  ])

  return {
    subject: workspaceSubject,
    config,
    popular: fulfilledOr(popularResult, [...EMPTY_HOME_DATA.popular]),
    recent: fulfilledOr(recentResult, [...EMPTY_HOME_DATA.recent]),
    publicItemCount: fulfilledOr(countResult, 0),
  }
}

export async function getMarketHomeAdminData(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeAdminData> {
  const preview = await getMarketHomeData(workspaceSubject)

  return {
    config: preview.config,
    preview,
  }
}
