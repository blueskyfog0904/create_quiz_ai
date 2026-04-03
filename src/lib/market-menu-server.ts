import { createAdminClient } from '@/lib/supabase/bypass'
import type { HeaderMenuChildItem, HeaderNavigationConfig } from '@/lib/header-navigation'
import {
  buildMarketMenuHref,
  type MarketChildrenSourceMode,
  type MarketMenuEntry,
  type MarketMenuEntryAdminRow,
} from '@/lib/market-menu'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

const MARKET_CHILDREN_SOURCE_MODE: MarketChildrenSourceMode = 'hybrid_fallback'

export interface LegacyMarketChildSummary {
  id: string
  title: string
  href: string
  isActive: boolean
  entryKey: string
  slug: string
  existsInDb: boolean
}

function getAdminSupabase() {
  return createAdminClient()
}

function normalizeText(value?: string | null) {
  return value?.trim() ?? ''
}

export function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function buildSearchConfig(slug: string) {
  return {
    marketSlug: slug,
    entryHref: buildMarketMenuHref({ slug }),
  }
}

function isMissingMarketMenuEntriesTableError(error: { message?: string | null, code?: string | null, details?: string | null }) {
  const message = error.message ?? ''
  const details = error.details ?? ''

  return error.code === 'PGRST205'
    || message.includes("Could not find the table 'public.market_menu_entries'")
    || message.includes('relation "public.market_menu_entries" does not exist')
    || message.includes('relation "market_menu_entries" does not exist')
    || details.includes('market_menu_entries')
}

function isDuplicateMarketMenuEntryError(error: { message?: string | null, code?: string | null, details?: string | null }) {
  const message = error.message ?? ''
  const details = error.details ?? ''

  return error.code === '23505'
    && (
      message.includes('market_menu_entries')
      || details.includes('market_menu_entries')
      || message.includes('subject_entry_key')
      || message.includes('workspace_entry_key')
      || message.includes('subject_slug')
      || message.includes('workspace_slug')
    )
}

function normalizeMarketMenuEntriesWriteError(error: { message?: string | null, code?: string | null, details?: string | null }) {
  if (isMissingMarketMenuEntriesTableError(error)) {
    return new Error('문제마켓 메뉴 테이블이 아직 준비되지 않았습니다. market_menu_entries 마이그레이션을 먼저 적용해주세요.')
  }

  if (isDuplicateMarketMenuEntryError(error)) {
    return new Error('같은 과목에 동일한 문제마켓 메뉴 slug가 이미 있습니다.')
  }

  return new Error(error.message ?? '문제마켓 메뉴 처리 중 오류가 발생했습니다.')
}

function getMappedLegacyKey(child: Pick<HeaderMenuChildItem, 'title' | 'href'>) {
  const href = child.href.trim()
  const absoluteUrl = new URL(href.startsWith('http') ? href : `https://example.com${href.startsWith('/') ? href : `/${href}`}`)
  const marketSlug = absoluteUrl.searchParams.get('marketSlug')
  const pathnameSlug = absoluteUrl.pathname.startsWith('/market/')
    ? absoluteUrl.pathname.replace(/^\/market\//, '')
    : absoluteUrl.pathname.replace(/^\//, '')

  const slug = normalizeSlug(marketSlug || pathnameSlug || child.title)

  return {
    entryKey: slug,
    slug,
  }
}

function validateEntryInput(input: {
  title?: string
  slug?: string
}) {
  const title = normalizeText(input.title)
  if (!title) {
    throw new Error('메뉴명을 입력해주세요.')
  }

  if (title.length > 30) {
    throw new Error('메뉴명은 30자 이하로 입력해주세요.')
  }

  const slug = normalizeSlug(input.slug || '')
  if (!slug) {
    throw new Error('slug를 입력해주세요.')
  }

  return {
    title,
    slug,
  }
}

export function getMarketChildrenSourceMode() {
  return MARKET_CHILDREN_SOURCE_MODE
}

export function getLegacyMarketChildren(baseConfig: HeaderNavigationConfig, existingEntries: MarketMenuEntry[]): LegacyMarketChildSummary[] {
  const marketParent = baseConfig.items.find((item) => item.href === '/market')
  const children = marketParent?.children ?? []
  const existingKeys = new Set(existingEntries.map((entry) => entry.entry_key))

  return children.map((child) => {
    const mapped = getMappedLegacyKey(child)
    return {
      id: child.id,
      title: child.title,
      href: child.href,
      isActive: child.isActive,
      entryKey: mapped.entryKey,
      slug: mapped.slug,
      existsInDb: existingKeys.has(mapped.entryKey),
    }
  })
}

export async function listMarketMenuEntriesForAdmin(workspaceSubject?: WorkspaceSubject): Promise<MarketMenuEntryAdminRow[]> {
  const supabase = getAdminSupabase()
  let query = supabase
    .from('market_menu_entries')
    .select('*')
    .order('sort_order')
    .order('created_at')

  if (workspaceSubject) {
    query = query.eq('workspace_subject', workspaceSubject)
  }

  const { data, error } = await query

  if (error) {
    if (isMissingMarketMenuEntriesTableError(error)) {
      return []
    }

    throw new Error(error.message)
  }

  return data ?? []
}

export async function listVisibleMarketMenuEntries(workspaceSubject: WorkspaceSubject = 'english'): Promise<MarketMenuEntry[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_menu_entries')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .eq('is_visible', true)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at')

  if (error) {
    if (isMissingMarketMenuEntriesTableError(error)) {
      return []
    }

    throw new Error(error.message)
  }

  return data ?? []
}

export async function getVisibleMarketMenuEntryBySlug(slug: string, workspaceSubject: WorkspaceSubject = 'english'): Promise<MarketMenuEntry | null> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_menu_entries')
    .select('*')
    .eq('slug', slug)
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .eq('is_visible', true)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    if (isMissingMarketMenuEntriesTableError(error)) {
      return null
    }

    throw new Error(error.message)
  }

  return data
}

export async function getMarketMenuEntryBySlugForAdmin(slug: string, workspaceSubject?: WorkspaceSubject): Promise<MarketMenuEntry | null> {
  const supabase = getAdminSupabase()
  let query = supabase
    .from('market_menu_entries')
    .select('*')
    .eq('slug', slug)

  if (workspaceSubject) {
    query = query.eq('workspace_subject', workspaceSubject)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    if (isMissingMarketMenuEntriesTableError(error)) {
      return null
    }

    throw new Error(error.message)
  }

  return data
}

export async function getMarketMenuEntriesBackfillStatus(baseConfig?: HeaderNavigationConfig, workspaceSubject?: WorkspaceSubject) {
  const supabase = getAdminSupabase()
  let query = supabase
    .from('market_menu_entries')
    .select('*')
    .is('deleted_at', null)

  if (workspaceSubject) {
    query = query.eq('workspace_subject', workspaceSubject)
  }

  const { data, error } = await query

  if (error) {
    if (isMissingMarketMenuEntriesTableError(error)) {
      return {
        sourceMode: getMarketChildrenSourceMode(),
        entryCount: 0,
        missingLegacyChildren: baseConfig ? getLegacyMarketChildren(baseConfig, []) : [],
      }
    }

    throw new Error(error.message)
  }

  const entries = data ?? []
  const legacyChildren = baseConfig ? getLegacyMarketChildren(baseConfig, entries) : []

  return {
    sourceMode: getMarketChildrenSourceMode(),
    entryCount: entries.length,
    missingLegacyChildren: legacyChildren.filter((child) => !child.existsInDb),
  }
}

export async function createMarketMenuEntry(
  input: Pick<TablesInsert<'market_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>,
  workspaceSubject: WorkspaceSubject = 'english'
) {
  const supabase = getAdminSupabase()
  const normalized = validateEntryInput(input)

  const payload: TablesInsert<'market_menu_entries'> & { subject_code: WorkspaceSubject, workspace_subject: WorkspaceSubject } = {
    subject_code: workspaceSubject,
    workspace_subject: workspaceSubject,
    entry_key: normalized.slug,
    slug: normalized.slug,
    title: normalized.title,
    description: normalizeText(input.description) || null,
    sort_order: input.sort_order ?? 0,
    is_visible: input.is_visible ?? true,
    is_active: input.is_active ?? true,
    search_config: input.search_config ?? buildSearchConfig(normalized.slug),
  }

  const { data, error } = await supabase
    .from('market_menu_entries')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw normalizeMarketMenuEntriesWriteError(error)
  }

  return data
}

export async function updateMarketMenuEntry(
  id: string,
  input: Pick<TablesUpdate<'market_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('market_menu_entries')
    .select('*')
    .eq('id', id)
    .single()

  if (currentError) {
    throw normalizeMarketMenuEntriesWriteError(currentError)
  }

  if (!current) {
    throw new Error('수정할 문제마켓 메뉴를 찾을 수 없습니다.')
  }

  const normalizedTitle = normalizeText(input.title ?? current.title)
  if (!normalizedTitle) {
    throw new Error('메뉴명을 입력해주세요.')
  }

  const nextSlug = normalizeSlug(input.slug ?? current.slug)
  if (!nextSlug) {
    throw new Error('slug를 입력해주세요.')
  }

  const payload: TablesUpdate<'market_menu_entries'> = {
    title: normalizedTitle,
    slug: nextSlug,
    entry_key: nextSlug,
    description: normalizeText(input.description ?? current.description) || null,
    sort_order: input.sort_order ?? current.sort_order,
    is_visible: input.is_visible ?? current.is_visible,
    is_active: input.is_active ?? current.is_active,
    search_config: input.search_config ?? current.search_config ?? buildSearchConfig(nextSlug),
  }

  const { data, error } = await supabase
    .from('market_menu_entries')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw normalizeMarketMenuEntriesWriteError(error)
  }

  return data
}

export async function archiveMarketMenuEntry(id: string) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('market_menu_entries')
    .select('*')
    .eq('id', id)
    .single()

  if (currentError) {
    throw normalizeMarketMenuEntriesWriteError(currentError)
  }

  if (!current) {
    throw new Error('삭제할 문제마켓 메뉴를 찾을 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_menu_entries')
    .update({
      is_active: false,
      is_visible: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw normalizeMarketMenuEntriesWriteError(error)
  }
}

export async function reorderMarketMenuEntries(ids: string[]) {
  const supabase = getAdminSupabase()

  const results = await Promise.all(ids.map((id, index) => (
    supabase
      .from('market_menu_entries')
      .update({ sort_order: (index + 1) * 10 })
      .eq('id', id)
  )))

  const failed = results.find((result) => result.error)
  if (failed?.error) {
    throw normalizeMarketMenuEntriesWriteError(failed.error)
  }
}

export async function backfillMarketMenuEntriesFromHeader(baseConfig: HeaderNavigationConfig, workspaceSubject?: WorkspaceSubject) {
  const supabase = getAdminSupabase()
  let existingEntriesQuery = supabase
    .from('market_menu_entries')
    .select('*')
    .is('deleted_at', null)

  if (workspaceSubject) {
    existingEntriesQuery = existingEntriesQuery.eq('workspace_subject', workspaceSubject)
  }

  const { data: existingEntries, error: existingError } = await existingEntriesQuery

  if (existingError) {
    throw normalizeMarketMenuEntriesWriteError(existingError)
  }

  const legacyChildren = getLegacyMarketChildren(baseConfig, existingEntries ?? [])
  const results: MarketMenuEntry[] = []

  for (const [index, child] of legacyChildren.entries()) {
    const payload: TablesInsert<'market_menu_entries'> & { subject_code?: WorkspaceSubject, workspace_subject?: WorkspaceSubject } = {
      subject_code: workspaceSubject,
      workspace_subject: workspaceSubject,
      entry_key: child.entryKey,
      slug: child.slug,
      title: child.title,
      description: `${child.title} 문제마켓 진입점`,
      sort_order: (index + 1) * 10,
      is_visible: child.isActive,
      is_active: child.isActive,
      search_config: buildSearchConfig(child.slug),
    }

    const { data, error } = await supabase
      .from('market_menu_entries')
      .upsert(payload, { onConflict: 'workspace_subject,entry_key' })
      .select('*')
      .single()

    if (error) {
      throw normalizeMarketMenuEntriesWriteError(error)
    }

    results.push(data)
  }

  return results
}
