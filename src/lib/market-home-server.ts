import { createAdminClient } from '@/lib/supabase/bypass'
import {
  DEFAULT_MARKET_HOME_CONFIG,
  MARKET_HOME_SETTING_KEY,
  normalizeMarketHomeConfig,
  type MarketHomeConfig,
  type MarketHomeData,
  type MarketHomeItem,
  type MarketHomeMenuEntry,
  type MarketHomePopularItem,
  type MarketHomeSourceConfig,
  type MarketHomeSourcePath,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type MenuRow = {
  id: string
  slug: string
  title: string
  description: string | null
  sort_order: number
}

type ItemRow = {
  id: string
  title: string
  summary: string | null
  thumbnail_url: string | null
  menu_entry_id: string
  question_count: number | null
  source_type: string | null
  source_1: string | null
  source_2: string | null
  source_3: string | null
  source_4: string | null
  published_at: string | null
  created_at: string
}

type SourceConfigRow = {
  id: string
  type_name: string
  source_1_label: string | null
  source_2_label: string | null
  source_3_label: string | null
  source_4_label: string | null
}

type PopularRow = {
  item_id: string
  download_issuer_user_count: number
}

export interface MarketHomeAdminOptions {
  categories: MarketHomeMenuEntry[]
  sourceTypes: MarketHomeSourceConfig[]
}

export interface MarketHomeAdminData extends MarketHomeAdminOptions {
  config: MarketHomeConfig
  preview: MarketHomeData
}

const EMPTY_HOME_DATA = {
  popular: [],
  sourceConfigs: [],
  sourcePaths: [],
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
  row: ItemRow,
  menusById: Map<string, MarketHomeMenuEntry>
): MarketHomeItem | null {
  const menu = menusById.get(row.menu_entry_id)
  if (!menu) return null

  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    thumbnailUrl: row.thumbnail_url,
    menuEntryId: row.menu_entry_id,
    categorySlug: menu.slug,
    categoryTitle: menu.title,
    questionCount: row.question_count,
    sourceType: normalizeText(row.source_type),
    sources: [row.source_1, row.source_2, row.source_3, row.source_4].map(normalizeText),
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
    .select('id, title, summary, thumbnail_url, menu_entry_id, question_count, source_type, source_1, source_2, source_3, source_4, published_at, created_at')
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
  return (data as ItemRow[]).flatMap((row) => {
    const item = toItem(row, menusById)
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
    .select('id, title, summary, thumbnail_url, menu_entry_id, question_count, source_type, source_1, source_2, source_3, source_4, published_at, created_at')
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('menu_entry_id', [...menusById.keys()])
    .in('id', rankings.map((row) => row.item_id))
  if (itemError) throw new Error(itemError.message)

  const itemsById = new Map(
    (itemData as ItemRow[]).flatMap((row) => {
      const item = toItem(row, menusById)
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

async function loadSourceExplorer(
  workspaceSubject: WorkspaceSubject,
  visibleMenuIds: string[],
  menusById: Map<string, MarketHomeMenuEntry>,
  selectedSourceTypes: string[]
): Promise<{ sourceConfigs: MarketHomeSourceConfig[]; sourcePaths: MarketHomeSourcePath[] }> {
  const supabase = getAdminClient()
  if (!supabase) return { sourceConfigs: [], sourcePaths: [] }

  let configQuery = supabase
    .from('source_configs')
    .select('id, type_name, source_1_label, source_2_label, source_3_label, source_4_label')
    .eq('workspace_subject', workspaceSubject)
    .order('type_name', { ascending: true })
    .order('id', { ascending: true })
  if (selectedSourceTypes.length > 0) {
    configQuery = configQuery.in('type_name', selectedSourceTypes)
  }

  const { data: configData, error: configError } = await configQuery
  if (configError) throw new Error(configError.message)

  const sourceConfigs = (configData as SourceConfigRow[]).map((row) => {
    const sourceLabels = [
      normalizeText(row.source_1_label),
      normalizeText(row.source_2_label),
      normalizeText(row.source_3_label),
      normalizeText(row.source_4_label),
    ]
    return {
      id: row.id,
      typeName: normalizeText(row.type_name) ?? row.type_name,
      sourceLabels,
      sourceIndexes: sourceLabels.flatMap((label, index) => label ? [index + 1] : []),
    }
  })

  if (visibleMenuIds.length === 0 || sourceConfigs.length === 0) {
    return { sourceConfigs, sourcePaths: [] }
  }

  const { data: itemData, error: itemError } = await supabase
    .from('market_items')
    .select('menu_entry_id, source_type, source_1, source_2, source_3, source_4')
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .in('menu_entry_id', visibleMenuIds)
  if (itemError) throw new Error(itemError.message)

  const configsByType = new Map(sourceConfigs.map((config) => [config.typeName, config]))
  const paths = new Map<string, MarketHomeSourcePath>()
  for (const row of itemData as Array<Pick<ItemRow, 'menu_entry_id' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4'>>) {
    const sourceType = normalizeText(row.source_type)
    const config = sourceType ? configsByType.get(sourceType) : null
    const menu = menusById.get(row.menu_entry_id)
    if (!sourceType || !config || !menu) continue

    const allSources = [row.source_1, row.source_2, row.source_3, row.source_4].map(normalizeText)
    const sourceValues = config.sourceIndexes.map((index) => allSources[index - 1])
    if (sourceValues.some((value) => value === null)) continue

    const values = sourceValues as string[]
    const key = JSON.stringify([menu.id, sourceType, config.sourceIndexes, values])
    const existing = paths.get(key)
    if (existing) {
      existing.itemCount += 1
    } else {
      paths.set(key, {
        sourceType,
        sourceIndexes: [...config.sourceIndexes],
        sourceValues: values,
        menuEntryId: menu.id,
        categorySlug: menu.slug,
        categoryTitle: menu.title,
        itemCount: 1,
      })
    }
  }

  return {
    sourceConfigs,
    sourcePaths: [...paths.values()].sort((left, right) => (
      left.sourceType.localeCompare(right.sourceType, 'ko')
      || left.categoryTitle.localeCompare(right.categoryTitle, 'ko')
      || left.sourceValues.join('\u0000').localeCompare(right.sourceValues.join('\u0000'), 'ko')
      || left.menuEntryId.localeCompare(right.menuEntryId)
    )),
  }
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

  const [popularResult, sourceResult, recentResult, countResult] = await Promise.allSettled([
    loadPopular(workspaceSubject, menusById, config.popular),
    config.sourceExplorer.isActive
      ? loadSourceExplorer(workspaceSubject, visibleMenuIds, menusById, config.sourceExplorer.sourceTypes)
      : Promise.resolve({ sourceConfigs: [], sourcePaths: [] }),
    config.recent.isActive
      ? loadRecent(workspaceSubject, visibleMenuIds, menusById, config.recent.limit)
      : Promise.resolve([]),
    countPublicItems(workspaceSubject, visibleMenuIds),
  ])

  const source = fulfilledOr(sourceResult, {
    sourceConfigs: [...EMPTY_HOME_DATA.sourceConfigs],
    sourcePaths: [...EMPTY_HOME_DATA.sourcePaths],
  })
  return {
    subject: workspaceSubject,
    config,
    categories: config.categories.isActive
      ? orderMenus(visibleMenus, config.categories.menuEntryIds)
      : [],
    popular: fulfilledOr(popularResult, [...EMPTY_HOME_DATA.popular]),
    sourceConfigs: source.sourceConfigs,
    sourcePaths: source.sourcePaths,
    recent: fulfilledOr(recentResult, [...EMPTY_HOME_DATA.recent]),
    publicItemCount: fulfilledOr(countResult, 0),
  }
}

export async function getMarketHomeAdminOptions(
  workspaceSubject: WorkspaceSubject
): Promise<MarketHomeAdminOptions> {
  const supabase = getAdminClient()
  const categoriesPromise = loadVisibleMenus(workspaceSubject)
  if (!supabase) {
    return {
      categories: await categoriesPromise,
      sourceTypes: [],
    }
  }

  const [categories, { data, error }] = await Promise.all([
    categoriesPromise,
    supabase
      .from('source_configs')
      .select('id, type_name, source_1_label, source_2_label, source_3_label, source_4_label')
      .eq('workspace_subject', workspaceSubject)
      .order('type_name', { ascending: true })
      .order('id', { ascending: true }),
  ])
  if (error) throw new Error(error.message)

  return {
    categories,
    sourceTypes: (data as SourceConfigRow[]).map((row) => {
      const sourceLabels = [
        normalizeText(row.source_1_label),
        normalizeText(row.source_2_label),
        normalizeText(row.source_3_label),
        normalizeText(row.source_4_label),
      ]
      return {
        id: row.id,
        typeName: normalizeText(row.type_name) ?? row.type_name,
        sourceLabels,
        sourceIndexes: sourceLabels.flatMap((label, index) => label ? [index + 1] : []),
      }
    }),
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
