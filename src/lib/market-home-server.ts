import { createAdminClient } from '@/lib/supabase/bypass'
import { loadMarketItemListEnrichment } from '@/lib/market-item-list-enrichment'
import {
  DEFAULT_MARKET_HOME_CONFIG,
  MARKET_HOME_SETTING_KEY,
  normalizeMarketHomeConfig,
  type MarketHomeConfig,
  type MarketHomeData,
  type MarketHomeItem,
  type MarketHomeMenuEntry,
  type MarketHomePopularItem,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  MARKET_THUMBNAIL_EMBED,
  toMarketThumbnailUrl,
  type MarketPublicUrlClient,
  type MarketThumbnailSource,
} from '@/lib/market-images'

type MenuRow = {
  id: string
  slug: string
  title: string
  description: string | null
  sort_order: number
}

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

export interface MarketHomeAdminOptions {
  categories: MarketHomeMenuEntry[]
}

export interface MarketHomeAdminData extends MarketHomeAdminOptions {
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

function toMenuEntry(row: MenuRow): MarketHomeMenuEntry {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
  }
}

function toItem(
  client: MarketPublicUrlClient,
  row: ItemRow,
  menusById: Map<string, MarketHomeMenuEntry>,
  enrichment: Awaited<ReturnType<typeof loadMarketItemListEnrichment>>
): MarketHomeItem | null {
  const menu = menusById.get(row.menu_entry_id)
  if (!menu) return null

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    thumbnailUrl: toMarketThumbnailUrl(client, row),
    menuEntryId: row.menu_entry_id,
    categorySlug: menu.slug,
    categoryTitle: menu.title,
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

async function loadVisibleMenus(workspaceSubject: WorkspaceSubject): Promise<MarketHomeMenuEntry[]> {
  const supabase = getAdminClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('market_menu_entries')
    .select('id, slug, title, description, sort_order')
    .eq('workspace_subject', workspaceSubject)
    .eq('is_visible', true)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(error.message)
  return (data as MenuRow[]).map(toMenuEntry)
}

function orderMenus(
  menus: MarketHomeMenuEntry[],
  configuredIds: string[]
): MarketHomeMenuEntry[] {
  if (configuredIds.length === 0) return menus.slice(0, 8)
  const menusById = new Map(menus.map((menu) => [menu.id, menu]))
  return configuredIds.flatMap((id) => {
    const menu = menusById.get(id)
    return menu ? [menu] : []
  }).slice(0, 8)
}

async function loadRecent(
  workspaceSubject: WorkspaceSubject,
  visibleMenuIds: string[],
  menusById: Map<string, MarketHomeMenuEntry>,
  limit: number
): Promise<MarketHomeItem[]> {
  const supabase = getAdminClient()
  if (!supabase || visibleMenuIds.length === 0) return []

  const { data, error } = await supabase
    .from('market_items')
    .select(ITEM_SELECT)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('menu_entry_id', visibleMenuIds)
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
  return rows.flatMap((row) => {
    const item = toItem(supabase, row, menusById, enrichment)
    return item ? [item] : []
  })
}

async function loadPopular(
  workspaceSubject: WorkspaceSubject,
  menusById: Map<string, MarketHomeMenuEntry>,
  config: MarketHomeConfig['popular']
): Promise<MarketHomePopularItem[]> {
  const supabase = getAdminClient()
  if (!supabase || menusById.size === 0 || !config.isActive) return []

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
    .in('menu_entry_id', [...menusById.keys()])
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
  const itemsById = new Map(
    itemRows.flatMap((row) => {
      const item = toItem(supabase, row, menusById, enrichment)
      return item ? [[item.id, item] as const] : []
    })
  )
  return rankings.flatMap((row) => {
    const item = itemsById.get(row.item_id)
    return item
      ? [{ ...item, downloadUserCount: Number(row.download_issuer_user_count) }]
      : []
  })
}

async function countPublicItems(
  workspaceSubject: WorkspaceSubject,
  visibleMenuIds: string[]
): Promise<number> {
  const supabase = getAdminClient()
  if (!supabase || visibleMenuIds.length === 0) return 0
  const { count, error } = await supabase
    .from('market_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('menu_entry_id', visibleMenuIds)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function getMarketHomeData(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeData> {
  const [configResult, menusResult] = await Promise.allSettled([
    loadConfig(workspaceSubject),
    loadVisibleMenus(workspaceSubject),
  ])
  const config = fulfilledOr(configResult, normalizeMarketHomeConfig(DEFAULT_MARKET_HOME_CONFIG))
  const visibleMenus = fulfilledOr(menusResult, [])
  const menusById = new Map(visibleMenus.map((menu) => [menu.id, menu]))
  const visibleMenuIds = visibleMenus.map((menu) => menu.id)

  const [popularResult, recentResult, countResult] = await Promise.allSettled([
    loadPopular(workspaceSubject, menusById, config.popular),
    config.recent.isActive
      ? loadRecent(workspaceSubject, visibleMenuIds, menusById, config.recent.limit)
      : Promise.resolve([]),
    countPublicItems(workspaceSubject, visibleMenuIds),
  ])

  return {
    subject: workspaceSubject,
    config,
    categories: config.categories.isActive
      ? orderMenus(visibleMenus, config.categories.menuEntryIds)
      : [],
    popular: fulfilledOr(popularResult, [...EMPTY_HOME_DATA.popular]),
    recent: fulfilledOr(recentResult, [...EMPTY_HOME_DATA.recent]),
    publicItemCount: fulfilledOr(countResult, 0),
  }
}

export async function getMarketHomeAdminOptions(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeAdminOptions> {
  return {
    categories: await loadVisibleMenus(workspaceSubject),
  }
}

export async function getMarketHomeAdminData(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeAdminData> {
  const [options, preview] = await Promise.all([
    getMarketHomeAdminOptions(workspaceSubject),
    getMarketHomeData(workspaceSubject),
  ])

  return {
    ...options,
    config: preview.config,
    preview,
  }
}
