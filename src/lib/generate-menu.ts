import type { Database } from '@/types/supabase'
import type {
  HeaderMenuChildItem,
  HeaderMenuItem,
  HeaderNavigationConfig,
} from '@/lib/header-navigation'

export type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
export type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
export type GenerateListboardPostItem = Database['public']['Tables']['generate_listboard_post_items']['Row']
export type GenerateListboardGenerationJob = Database['public']['Tables']['generate_listboard_generation_jobs']['Row']
export type GenerateListboardGenerationJobItem = Database['public']['Tables']['generate_listboard_generation_job_items']['Row']

export interface GenerateMenuEntryAdminRow extends GenerateMenuEntry {
  postCount: number
}

export type GenerateChildrenSourceMode = 'legacy_json' | 'hybrid_fallback' | 'db_authoritative'

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
  }
}

function cloneChild(child: HeaderMenuChildItem): HeaderMenuChildItem {
  return { ...child }
}

function cloneItem(item: HeaderMenuItem): HeaderMenuItem {
  return {
    ...item,
    children: item.children.map(cloneChild),
  }
}

export function ensureGenerateParent(config: HeaderNavigationConfig) {
  const clonedItems = config.items.map(cloneItem)
  const existingIndex = clonedItems.findIndex((item) => item.href === GENERATE_PARENT_HREF)

  if (existingIndex >= 0) {
    return {
      config: {
        ...config,
        items: clonedItems,
      },
      wasSynthesized: false,
    }
  }

  clonedItems.unshift({
    id: GENERATE_PARENT_FALLBACK_ID,
    title: GENERATE_PARENT_FALLBACK_TITLE,
    href: GENERATE_PARENT_HREF,
    isActive: true,
    children: [],
  })

  return {
    config: {
      ...config,
      items: clonedItems,
    },
    wasSynthesized: true,
  }
}

function isLegacyChildCoveredByEntry(child: HeaderMenuChildItem, entry: GenerateMenuEntry) {
  return child.title === entry.title
}

export function mergeGenerateEntriesIntoHeaderConfig(
  baseConfig: HeaderNavigationConfig,
  generateEntries: GenerateMenuEntry[],
  sourceMode: GenerateChildrenSourceMode = 'hybrid_fallback'
): HeaderNavigationConfig {
  if (sourceMode === 'legacy_json') {
    return {
      ...baseConfig,
      items: baseConfig.items.map(cloneItem),
    }
  }

  const { config } = ensureGenerateParent(baseConfig)
  const entries = generateEntries
    .filter((entry) => entry.deleted_at === null)
    .filter((entry) => sourceMode !== 'db_authoritative' || (entry.is_active && entry.is_visible))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko'))

  return {
    ...config,
    items: config.items.map((item) => {
      if (item.href !== GENERATE_PARENT_HREF) {
        return cloneItem(item)
      }

      const dbChildren = entries.map(buildGenerateHeaderChildItem)
      const shouldFallback = sourceMode === 'hybrid_fallback' && dbChildren.length === 0

      if (shouldFallback) {
        return cloneItem(item)
      }

      const legacyChildren = sourceMode === 'hybrid_fallback'
        ? item.children
            .filter((child) => !entries.some((entry) => isLegacyChildCoveredByEntry(child, entry)))
            .map(cloneChild)
        : []

      return {
        ...item,
        children: [...dbChildren, ...legacyChildren],
      }
    }),
  }
}
