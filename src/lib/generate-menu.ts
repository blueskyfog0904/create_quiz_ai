import type { Database } from '@/types/supabase'
import type {
  HeaderMenuChildItem,
  HeaderNavigationConfig,
} from '@/lib/header-navigation'
import {
  mergeDbManagedChildrenIntoHeaderConfig,
  type DbManagedChildrenSourceMode,
} from '@/lib/db-managed-header'

export type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
export type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
export type GenerateListboardPostItem = Database['public']['Tables']['generate_listboard_post_items']['Row']
export type GenerateListboardGenerationJob = Database['public']['Tables']['generate_listboard_generation_jobs']['Row']
export type GenerateListboardGenerationJobItem = Database['public']['Tables']['generate_listboard_generation_job_items']['Row']

export interface GenerateMenuEntryAdminRow extends GenerateMenuEntry {
  postCount: number
}

export type GenerateChildrenSourceMode = DbManagedChildrenSourceMode

export const GENERATE_PARENT_FALLBACK_ID = 'menu-generate'
export const GENERATE_PARENT_FALLBACK_TITLE = 'AI문제생성'
export const GENERATE_PARENT_HREF = '/generate'
export const GENERATE_PERSONAL_HREF = '/generate/personal'
export const LISTBOARD_GRADE_OPTIONS = ['1학년', '2학년', '3학년'] as const

export type ListboardGradeOption = typeof LISTBOARD_GRADE_OPTIONS[number]

export function normalizeListboardGradeLevel(value?: string | null): ListboardGradeOption | null {
  const normalized = value?.trim()
  if (!normalized) {
    return null
  }

  if (LISTBOARD_GRADE_OPTIONS.includes(normalized as ListboardGradeOption)) {
    return normalized as ListboardGradeOption
  }

  const normalizedKey = normalized.toLowerCase().replace(/\s+/g, '')
  const legacyMap: Record<string, ListboardGradeOption> = {
    '1': '1학년',
    '1학년': '1학년',
    '고1': '1학년',
    'high1': '1학년',
    'middle1': '1학년',
    '2': '2학년',
    '2학년': '2학년',
    '고2': '2학년',
    'high2': '2학년',
    'middle2': '2학년',
    '3': '3학년',
    '3학년': '3학년',
    '고3': '3학년',
    'high3': '3학년',
    'middle3': '3학년',
  }

  return legacyMap[normalizedKey] ?? null
}


interface GenerateMenuSearchConfig {
  filters?: string[]
  entryHref?: string
  showDividerBefore?: boolean
}

export function getGenerateMenuEntryShowDividerBefore(entry: Pick<GenerateMenuEntry, 'entry_type' | 'search_config'>) {
  const searchConfig = entry.search_config as GenerateMenuSearchConfig | null
  if (typeof searchConfig?.showDividerBefore === 'boolean') {
    return searchConfig.showDividerBefore
  }

  return entry.entry_type === 'personal_generate'
}

export function buildGenerateMenuHref(entry: Pick<GenerateMenuEntry, 'entry_type' | 'slug'>) {
  if (entry.entry_type === 'personal_generate') {
    return GENERATE_PERSONAL_HREF
  }

  return `/generate/boards/${entry.slug}`
}

export function buildGenerateHeaderChildItem(entry: GenerateMenuEntry): HeaderMenuChildItem {
  return {
    id: `generate-entry-${entry.entry_key}`,
    title: entry.title,
    href: buildGenerateMenuHref(entry),
    isActive: entry.is_active && entry.is_visible && entry.deleted_at === null,
    showDividerBefore: getGenerateMenuEntryShowDividerBefore(entry),
  }
}

export function mergeGenerateEntriesIntoHeaderConfig(
  baseConfig: HeaderNavigationConfig,
  generateEntries: GenerateMenuEntry[],
  sourceMode: GenerateChildrenSourceMode = 'hybrid_fallback',
  options?: {
    parentAllowed?: boolean
  }
): HeaderNavigationConfig {
  const entries = generateEntries
    .filter((entry) => entry.deleted_at === null)
    .filter((entry) => sourceMode !== 'db_authoritative' || (entry.is_active && entry.is_visible))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko'))

  return mergeDbManagedChildrenIntoHeaderConfig(
    baseConfig,
    entries.map(buildGenerateHeaderChildItem),
    {
      parentHref: GENERATE_PARENT_HREF,
      fallbackId: GENERATE_PARENT_FALLBACK_ID,
      fallbackTitle: GENERATE_PARENT_FALLBACK_TITLE,
      parentAllowed: options?.parentAllowed ?? true,
    },
    sourceMode
  )
}
