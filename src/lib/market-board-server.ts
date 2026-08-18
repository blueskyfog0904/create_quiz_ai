import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  MARKET_BOARD_DEFAULT_PAGE_SIZE,
  MARKET_BOARD_MAX_PAGE_SIZE,
  type MarketBoardCategoryGroup,
  type MarketBoardData,
  type MarketBoardQuery,
  type MarketBoardResult,
  type MarketBoardRow,
  type MarketBoardSourceConfig,
  type MarketBoardSourceFieldKey,
  type MarketBoardSort,
} from '@/lib/market-board'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type GroupRow = {
  id: string
  title: string
  sort_order: number
}

type MenuRow = {
  id: string
  slug: string
  title: string
  description: string | null
  sort_order: number
  group_id: string | null
}

type ItemMetadataRow = {
  menu_entry_id: string
  exam_year: number | null
  exam_month: number | null
  grade_level: string | null
  source_type: string | null
}

type ItemRow = {
  id: string
  title: string
  summary: string | null
  thumbnail_url: string | null
  menu_entry_id: string
  exam_year: number | null
  exam_month: number | null
  grade_level: string | null
  question_count: number | null
  source_type: string | null
  source_1: string | null
  source_2: string | null
  source_3: string | null
  source_4: string | null
  pdf_price: number
  hwp_price: number
  zip_price: number
  view_count: number
  published_at: string | null
  created_at: string
}

type SourceConfigRow = {
  type_name: string
  source_1_label: string | null
  source_1_options: string[] | null
  source_2_label: string | null
  source_2_options: string[] | null
  source_3_label: string | null
  source_3_options: string[] | null
  source_4_label: string | null
  source_4_options: string[] | null
}

type SamplePageRow = {
  item_id: string
  page_number: number
}

type SubproductRow = {
  item_id: string
  price_credits: number
}

type BundleOptionRow = {
  item_id: string
  price_credits: number
}

type ReviewRow = {
  item_id: string
  rating: number
}

type LegacyFileRow = {
  item_id: string
  asset_kind: string
}

type SourceValueKey = 'source_1' | 'source_2' | 'source_3' | 'source_4'

const ITEM_SELECT = [
  'id',
  'title',
  'summary',
  'thumbnail_url',
  'menu_entry_id',
  'exam_year',
  'exam_month',
  'grade_level',
  'question_count',
  'source_type',
  'source_1',
  'source_2',
  'source_3',
  'source_4',
  'pdf_price',
  'hwp_price',
  'zip_price',
  'view_count',
  'published_at',
  'created_at',
].join(', ')

const SOURCE_CONFIG_SELECT = [
  'type_name',
  'source_1_label',
  'source_1_options',
  'source_2_label',
  'source_2_options',
  'source_3_label',
  'source_3_options',
  'source_4_label',
  'source_4_options',
].join(', ')

const SOURCE_FIELD_DEFINITIONS: Array<{
  key: MarketBoardSourceFieldKey
  valueKey: SourceValueKey
  labelKey: keyof Pick<SourceConfigRow,
    'source_1_label' | 'source_2_label' | 'source_3_label' | 'source_4_label'>
  optionsKey: keyof Pick<SourceConfigRow,
    'source_1_options' | 'source_2_options' | 'source_3_options' | 'source_4_options'>
}> = [
  { key: 'source1', valueKey: 'source_1', labelKey: 'source_1_label', optionsKey: 'source_1_options' },
  { key: 'source2', valueKey: 'source_2', labelKey: 'source_2_label', optionsKey: 'source_2_options' },
  { key: 'source3', valueKey: 'source_3', labelKey: 'source_3_label', optionsKey: 'source_3_options' },
  { key: 'source4', valueKey: 'source_4', labelKey: 'source_4_label', optionsKey: 'source_4_options' },
]

function getAdminClient(): SupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }

  return createAdminClient() as unknown as SupabaseClient
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim().normalize('NFC')
  return normalized || null
}

function uniqueText(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.flatMap((value) => {
    const normalized = normalizeText(value)
    return normalized ? [normalized] : []
  })))
}

function normalizePage(value: number | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    return MARKET_BOARD_DEFAULT_PAGE_SIZE
  }
  return Math.min(Number(value), MARKET_BOARD_MAX_PAGE_SIZE)
}

function normalizeSort(value: MarketBoardSort | undefined): MarketBoardSort {
  return value === 'views' || value === 'questions' ? value : 'latest'
}

function toSourceConfigs(rows: SourceConfigRow[]): MarketBoardSourceConfig[] {
  return rows.flatMap((row) => {
    const typeName = normalizeText(row.type_name)
    if (!typeName) return []

    const fields = SOURCE_FIELD_DEFINITIONS.flatMap((definition) => {
      const label = normalizeText(row[definition.labelKey])
      if (!label) return []

      return [{
        key: definition.key,
        label,
        options: uniqueText(row[definition.optionsKey] ?? []),
      }]
    })

    return [{ typeName, fields }]
  })
}

function toGroups(
  subject: WorkspaceSubject,
  groupRows: GroupRow[],
  menuRows: MenuRow[],
  itemCounts: Map<string, number>
): MarketBoardCategoryGroup[] {
  const entriesByGroupId = new Map<string, MenuRow[]>()
  const ungroupedEntries: MenuRow[] = []

  for (const menu of menuRows) {
    if (menu.group_id === null) {
      ungroupedEntries.push(menu)
      continue
    }

    const entries = entriesByGroupId.get(menu.group_id) ?? []
    entries.push(menu)
    entriesByGroupId.set(menu.group_id, entries)
  }

  const toEntries = (entries: MenuRow[]) => entries.map((entry) => ({
    id: entry.id,
    slug: entry.slug,
    title: entry.title,
    description: entry.description,
    itemCount: itemCounts.get(entry.id) ?? 0,
  }))

  const groups = groupRows.flatMap((group) => {
    const entries = entriesByGroupId.get(group.id) ?? []
    return entries.length > 0
      ? [{
        id: group.id,
        title: group.title,
        isUngrouped: false,
        entries: toEntries(entries),
      }]
      : []
  })

  if (ungroupedEntries.length > 0) {
    groups.push({
      id: `ungrouped:${subject}`,
      title: '기타',
      isUngrouped: true,
      entries: toEntries(ungroupedEntries),
    })
  }

  return groups
}

type MarketMenuSchemaError = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

function isMissingMarketMenuGroupSchemaError(error: MarketMenuSchemaError | null | undefined) {
  if (!error) return false

  const text = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const targetsGroupSchema = (
    text.includes('market_menu_groups')
    || (text.includes('market_menu_entries') && text.includes('group_id'))
  )
  if (!targetsGroupSchema) return false

  return (
    ['PGRST204', 'PGRST205', '42P01', '42703'].includes(error.code ?? '')
    || text.includes('schema cache')
    || text.includes('does not exist')
    || text.includes('could not find')
  )
}

async function loadTaxonomy(supabase: SupabaseClient, subject: WorkspaceSubject) {
  const [
    { data: groupData, error: groupError },
    { data: menuData, error: menuError },
  ] = await Promise.all([
    supabase
      .from('market_menu_groups')
      .select('id, title, sort_order')
      .eq('workspace_subject', subject)
      .eq('is_visible', true)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })
      .order('id', { ascending: true }),
    supabase
      .from('market_menu_entries')
      .select('id, slug, title, description, sort_order, group_id')
      .eq('workspace_subject', subject)
      .eq('is_visible', true)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })
      .order('id', { ascending: true }),
  ])

  if (!groupError && !menuError) {
    return {
      groups: (groupData ?? []) as GroupRow[],
      menus: (menuData ?? []) as MenuRow[],
    }
  }

  const errors = [groupError, menuError].filter((error): error is NonNullable<typeof error> => Boolean(error))
  const hasUnexpectedError = errors.some((error) => !isMissingMarketMenuGroupSchemaError(error))
  if (hasUnexpectedError) {
    throw new Error(errors.find((error) => !isMissingMarketMenuGroupSchemaError(error))?.message)
  }

  if (
    !isMissingMarketMenuGroupSchemaError(groupError)
    && !isMissingMarketMenuGroupSchemaError(menuError)
  ) {
    throw new Error(errors[0]?.message)
  }

  const { data: fallbackMenuData, error: fallbackMenuError } = await supabase
    .from('market_menu_entries')
    .select('id, slug, title, description, sort_order')
    .eq('workspace_subject', subject)
    .eq('is_visible', true)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })
    .order('id', { ascending: true })

  if (fallbackMenuError) throw new Error(fallbackMenuError.message)

  return {
    groups: [],
    menus: ((fallbackMenuData ?? []) as Array<Omit<MenuRow, 'group_id'>>).map((menu) => ({
      ...menu,
      group_id: null,
    })),
  }
}

async function loadBoardRowEnrichment(
  supabase: SupabaseClient,
  subject: WorkspaceSubject,
  items: ItemRow[]
) {
  const itemIds = items.map((item) => item.id)
  if (itemIds.length === 0) {
    return {
      sampleCounts: new Map<string, number>(),
      startingPrices: new Map<string, number>(),
      ratingSummaries: new Map<string, { average: number; count: number }>(),
    }
  }

  const [
    { data: sampleData, error: sampleError },
    { data: subproductData, error: subproductError },
    { data: bundleData, error: bundleError },
    { data: legacyFileData, error: legacyFileError },
    { data: reviewData, error: reviewError },
  ] = await Promise.all([
    supabase
      .from('market_item_sample_pages')
      .select('item_id, page_number')
      .eq('workspace_subject', subject)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('item_id', itemIds),
    supabase
      .from('market_item_subproducts')
      .select('item_id, price_credits')
      .eq('workspace_subject', subject)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('item_id', itemIds),
    supabase
      .from('market_item_bundle_options')
      .select('item_id, price_credits')
      .eq('workspace_subject', subject)
      .eq('is_active', true)
      .in('item_id', itemIds),
    supabase
      .from('market_item_files')
      .select('item_id, asset_kind')
      .eq('workspace_subject', subject)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('asset_kind', ['pdf', 'hwp', 'zip'])
      .in('item_id', itemIds),
    supabase
      .from('market_item_reviews')
      .select('item_id, rating')
      .eq('workspace_subject', subject)
      .is('deleted_at', null)
      .in('item_id', itemIds),
  ])

  if (
    sampleError
    || subproductError
    || bundleError
    || legacyFileError
    || reviewError
  ) {
    throw new Error(
      sampleError?.message
      ?? subproductError?.message
      ?? bundleError?.message
      ?? legacyFileError?.message
      ?? reviewError?.message
    )
  }

  const sampleCounts = new Map<string, number>()
  for (const row of (sampleData ?? []) as SamplePageRow[]) {
    sampleCounts.set(row.item_id, (sampleCounts.get(row.item_id) ?? 0) + 1)
  }

  const priceCandidates = new Map<string, number[]>()
  const addPrice = (itemId: string, price: number) => {
    const prices = priceCandidates.get(itemId) ?? []
    prices.push(price)
    priceCandidates.set(itemId, prices)
  }
  for (const row of (subproductData ?? []) as SubproductRow[]) {
    addPrice(row.item_id, row.price_credits)
  }
  for (const row of (bundleData ?? []) as BundleOptionRow[]) {
    addPrice(row.item_id, row.price_credits)
  }

  const itemsById = new Map(items.map((item) => [item.id, item]))
  for (const file of (legacyFileData ?? []) as LegacyFileRow[]) {
    const item = itemsById.get(file.item_id)
    if (!item) continue

    const price = file.asset_kind === 'pdf'
      ? item.pdf_price
      : file.asset_kind === 'hwp'
        ? item.hwp_price
        : item.zip_price
    if (price > 0) addPrice(file.item_id, price)
  }

  const startingPrices = new Map<string, number>()
  for (const itemId of itemIds) {
    const prices = priceCandidates.get(itemId)
    if (prices && prices.length > 0) startingPrices.set(itemId, Math.min(...prices))
  }

  const ratingTotals = new Map<string, { total: number; count: number }>()
  for (const review of (reviewData ?? []) as ReviewRow[]) {
    const current = ratingTotals.get(review.item_id) ?? { total: 0, count: 0 }
    current.total += review.rating
    current.count += 1
    ratingTotals.set(review.item_id, current)
  }
  const ratingSummaries = new Map<string, { average: number; count: number }>()
  for (const [itemId, rating] of ratingTotals) {
    ratingSummaries.set(itemId, {
      average: rating.total / rating.count,
      count: rating.count,
    })
  }

  return { sampleCounts, startingPrices, ratingSummaries }
}

function toBoardRows(
  items: ItemRow[],
  categoryTitle: string,
  sourceConfigs: MarketBoardSourceConfig[],
  sampleCounts: Map<string, number>,
  startingPrices: Map<string, number>,
  ratingSummaries: Map<string, { average: number; count: number }>
): MarketBoardRow[] {
  const sourceConfigsByType = new Map(sourceConfigs.map((config) => [config.typeName, config]))

  return items.map((item) => {
    const materialType = normalizeText(item.source_type)
    const config = materialType ? sourceConfigsByType.get(materialType) : null
    const sourceFields = config
      ? config.fields.flatMap((field) => {
        const definition = SOURCE_FIELD_DEFINITIONS.find((candidate) => candidate.key === field.key)
        const value = definition ? normalizeText(item[definition.valueKey]) : null
        return value ? [{ label: field.label, value }] : []
      })
      : []
    const pageCount = sampleCounts.get(item.id) ?? 0

    return {
      id: item.id,
      title: item.title,
      summary: normalizeText(item.summary),
      thumbnailUrl: normalizeText(item.thumbnail_url),
      categoryTitle,
      materialType,
      sourceFields,
      examYear: item.exam_year,
      examMonth: item.exam_month,
      gradeLevel: normalizeText(item.grade_level),
      questionCount: item.question_count,
      sample: {
        available: pageCount > 0,
        pageCount,
      },
      startingPriceCredits: startingPrices.get(item.id) ?? null,
      ratingAverage: ratingSummaries.get(item.id)?.average ?? null,
      ratingCount: ratingSummaries.get(item.id)?.count ?? 0,
      viewCount: item.view_count,
      publishedAt: item.published_at ?? item.created_at,
    }
  })
}

export async function getMarketBoardData(input: MarketBoardQuery): Promise<MarketBoardResult> {
  const supabase = getAdminClient()
  if (!supabase) {
    return { status: 'error', message: '게시판 데이터 연결 설정을 확인해주세요.' }
  }

  const subject = input.subject
  const slug = normalizeText(input.slug)
  if (!slug) return { status: 'not_found' }

  try {
    const [
      taxonomy,
      { data: sourceConfigData, error: sourceConfigError },
    ] = await Promise.all([
      loadTaxonomy(supabase, subject),
      supabase
        .from('source_configs')
        .select(SOURCE_CONFIG_SELECT)
        .eq('workspace_subject', subject)
        .order('type_name', { ascending: true })
        .order('id', { ascending: true }),
    ])

    if (sourceConfigError) throw new Error(sourceConfigError.message)

    const groupRows = taxonomy.groups
    const visibleGroupIds = new Set(groupRows.map((group) => group.id))
    const menuRows = taxonomy.menus.filter((menu) => (
      menu.group_id === null || visibleGroupIds.has(menu.group_id)
    ))
    const category = menuRows.find((menu) => menu.slug === slug)
    if (!category) return { status: 'not_found' }

    const menuIds = menuRows.map((menu) => menu.id)
    const { data: countData, error: countError } = menuIds.length > 0
      ? await supabase
        .from('market_items')
        .select('menu_entry_id')
        .in('menu_entry_id', menuIds)
        .eq('workspace_subject', subject)
        .eq('status', 'published')
        .eq('is_active', true)
        .is('deleted_at', null)
      : { data: [], error: null }
    if (countError) throw new Error(countError.message)

    const itemCounts = new Map<string, number>()
    for (const row of (countData ?? []) as Array<Pick<ItemMetadataRow, 'menu_entry_id'>>) {
      itemCounts.set(row.menu_entry_id, (itemCounts.get(row.menu_entry_id) ?? 0) + 1)
    }

    const configuredSourceConfigs = toSourceConfigs(
      (sourceConfigData ?? []) as unknown as SourceConfigRow[]
    )
    const { data: metadataData, error: metadataError } = await supabase
      .from('market_items')
      .select('menu_entry_id, exam_year, exam_month, grade_level, source_type')
      .eq('menu_entry_id', category.id)
      .eq('workspace_subject', subject)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null)
    if (metadataError) throw new Error(metadataError.message)

    const metadataRows = (metadataData ?? []) as unknown as ItemMetadataRow[]
    const configuredSourceTypes = new Set(
      configuredSourceConfigs.map((config) => config.typeName)
    )
    const sourceConfigs = [
      ...configuredSourceConfigs,
      ...uniqueText(metadataRows.map((row) => row.source_type))
        .filter((typeName) => !configuredSourceTypes.has(typeName))
        .map((typeName) => ({ typeName, fields: [] })),
    ].sort((left, right) => left.typeName.localeCompare(right.typeName, 'ko'))
    const page = normalizePage(input.page)
    const pageSize = normalizePageSize(input.pageSize)
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    const sort = normalizeSort(input.sort)

    let itemQuery = supabase
      .from('market_items')
      .select(ITEM_SELECT, { count: 'exact' })
      .eq('menu_entry_id', category.id)
      .eq('workspace_subject', subject)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null)

    const search = normalizeText(input.search)
    if (search) itemQuery = itemQuery.ilike('title', `%${search}%`)
    if (input.examYear !== undefined) itemQuery = itemQuery.eq('exam_year', input.examYear)
    if (input.examMonth !== undefined) itemQuery = itemQuery.eq('exam_month', input.examMonth)

    const gradeLevel = normalizeText(input.gradeLevel)
    if (gradeLevel) itemQuery = itemQuery.eq('grade_level', gradeLevel)

    const requestedSourceType = normalizeText(input.sourceType)
    const sourceType = requestedSourceType && sourceConfigs.some((config) => (
      config.typeName === requestedSourceType
    ))
      ? requestedSourceType
      : null
    if (sourceType) itemQuery = itemQuery.eq('source_type', sourceType)

    const activeSourceConfig = sourceType
      ? sourceConfigs.find((config) => config.typeName === sourceType)
      : null
    for (const definition of SOURCE_FIELD_DEFINITIONS) {
      const field = activeSourceConfig?.fields.find((candidate) => (
        candidate.key === definition.key
      ))
      const value = normalizeText(input[definition.key])
      if (
        field
        && value
        && (field.options.length === 0 || field.options.includes(value))
      ) {
        itemQuery = itemQuery.eq(definition.valueKey, value)
      }
    }

    if (sort === 'views') {
      itemQuery = itemQuery.order('view_count', { ascending: false })
    } else if (sort === 'questions') {
      itemQuery = itemQuery.order('question_count', { ascending: false, nullsFirst: false })
    }
    itemQuery = itemQuery
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })

    const { data: itemData, error: itemError, count } = await itemQuery
      .range(from, to)
    if (itemError) throw new Error(itemError.message)

    const items = (itemData ?? []) as unknown as ItemRow[]
    const enrichment = await loadBoardRowEnrichment(supabase, subject, items)
    const group = category.group_id
      ? groupRows.find((row) => row.id === category.group_id) ?? null
      : null
    const total = count ?? 0

    const data: MarketBoardData = {
      subject,
      groups: toGroups(subject, groupRows, menuRows, itemCounts),
      category: {
        id: category.id,
        slug: category.slug,
        title: category.title,
        description: normalizeText(category.description),
        groupId: group?.id ?? null,
        groupTitle: normalizeText(group?.title),
      },
      total,
      filters: {
        years: Array.from(new Set(metadataRows.flatMap((row) => (
          row.exam_year === null ? [] : [row.exam_year]
        )))).sort((left, right) => right - left),
        months: Array.from(new Set(metadataRows.flatMap((row) => (
          row.exam_month === null ? [] : [row.exam_month]
        )))).sort((left, right) => left - right),
        grades: uniqueText(metadataRows.map((row) => row.grade_level))
          .sort((left, right) => left.localeCompare(right, 'ko')),
        sourceConfigs,
      },
      rows: toBoardRows(
        items,
        category.title,
        sourceConfigs,
        enrichment.sampleCounts,
        enrichment.startingPrices,
        enrichment.ratingSummaries
      ),
      pagination: {
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      },
    }

    return { status: 'ready', data }
  } catch (error) {
    console.error('[market-board] failed to load public board data', error)
    return { status: 'error', message: '게시판 자료를 불러오지 못했습니다.' }
  }
}
