import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const MARKET_HOME_SETTING_KEY = 'market_home'

export const MARKET_HOME_LIMITS = {
  popular: { min: 1, max: 24 },
  rankingWindowDays: { min: 1, max: 90 },
  recent: { min: 1, max: 24 },
  categories: { max: 8 },
} as const

export interface MarketHomeConfig {
  version: 1
  popular: {
    isActive: boolean
    limit: number
    rankingWindowDays: number
  }
  sourceExplorer: {
    isActive: boolean
    sourceTypes: string[]
  }
  categories: {
    isActive: boolean
    menuEntryIds: string[]
  }
  recent: {
    isActive: boolean
    limit: number
  }
}

export const DEFAULT_MARKET_HOME_CONFIG: MarketHomeConfig = {
  version: 1,
  popular: {
    isActive: true,
    limit: 12,
    rankingWindowDays: 30,
  },
  sourceExplorer: {
    isActive: true,
    sourceTypes: [],
  },
  categories: {
    isActive: true,
    menuEntryIds: [],
  },
  recent: {
    isActive: true,
    limit: 8,
  },
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
  menuEntryId: string
  categorySlug: string
  categoryTitle: string
  questionCount: number | null
  sourceType: string | null
  sources: Array<string | null>
  publishedAt: string | null
  createdAt: string
}

export interface MarketHomePopularItem extends MarketHomeItem {
  downloadUserCount: number
}

export interface MarketHomeSourceConfig {
  id: string
  typeName: string
  sourceLabels: Array<string | null>
  sourceIndexes: number[]
}

export interface MarketHomeSourcePath {
  sourceType: string
  sourceIndexes: number[]
  sourceValues: string[]
  menuEntryId: string
  categorySlug: string
  categoryTitle: string
  itemCount: number
}

export interface MarketHomeData {
  subject: WorkspaceSubject
  config: MarketHomeConfig
  categories: MarketHomeMenuEntry[]
  popular: MarketHomePopularItem[]
  sourceConfigs: MarketHomeSourceConfig[]
  sourcePaths: MarketHomeSourcePath[]
  recent: MarketHomeItem[]
  publicItemCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
) {
  const allowed = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) {
    throw new Error(`${label}.${unexpected} is not supported`)
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`)
  }
}

function assertIntegerInRange(
  value: unknown,
  range: { min: number; max: number },
  label: string
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < range.min || (value as number) > range.max) {
    throw new Error(`${label} must be an integer between ${range.min} and ${range.max}`)
  }
}

function assertUniqueStrings(value: unknown, label: string, max?: number): asserts value is string[] {
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string' || entry.trim() !== entry || entry.length === 0)
    || new Set(value).size !== value.length
    || (max !== undefined && value.length > max)
  ) {
    throw new Error(`${label} must contain unique non-empty strings`)
  }
}

export function validateMarketHomeConfig(value: unknown): MarketHomeConfig {
  if (!isRecord(value)) {
    throw new Error('market home config must be an object')
  }
  assertExactKeys(value, ['version', 'popular', 'sourceExplorer', 'categories', 'recent'], 'config')
  if (value.version !== 1) {
    throw new Error('config.version must be 1')
  }

  const popular = value.popular
  const sourceExplorer = value.sourceExplorer
  const categories = value.categories
  const recent = value.recent
  if (!isRecord(popular) || !isRecord(sourceExplorer) || !isRecord(categories) || !isRecord(recent)) {
    throw new Error('market home sections must be objects')
  }

  assertExactKeys(popular, ['isActive', 'limit', 'rankingWindowDays'], 'popular')
  assertBoolean(popular.isActive, 'popular.isActive')
  assertIntegerInRange(popular.limit, MARKET_HOME_LIMITS.popular, 'popular.limit')
  assertIntegerInRange(
    popular.rankingWindowDays,
    MARKET_HOME_LIMITS.rankingWindowDays,
    'popular.rankingWindowDays'
  )

  assertExactKeys(sourceExplorer, ['isActive', 'sourceTypes'], 'sourceExplorer')
  assertBoolean(sourceExplorer.isActive, 'sourceExplorer.isActive')
  assertUniqueStrings(sourceExplorer.sourceTypes, 'sourceExplorer.sourceTypes')

  assertExactKeys(categories, ['isActive', 'menuEntryIds'], 'categories')
  assertBoolean(categories.isActive, 'categories.isActive')
  assertUniqueStrings(categories.menuEntryIds, 'categories.menuEntryIds', MARKET_HOME_LIMITS.categories.max)

  assertExactKeys(recent, ['isActive', 'limit'], 'recent')
  assertBoolean(recent.isActive, 'recent.isActive')
  assertIntegerInRange(recent.limit, MARKET_HOME_LIMITS.recent, 'recent.limit')

  return {
    version: 1,
    popular: {
      isActive: popular.isActive,
      limit: popular.limit,
      rankingWindowDays: popular.rankingWindowDays,
    },
    sourceExplorer: {
      isActive: sourceExplorer.isActive,
      sourceTypes: [...sourceExplorer.sourceTypes],
    },
    categories: {
      isActive: categories.isActive,
      menuEntryIds: [...categories.menuEntryIds],
    },
    recent: {
      isActive: recent.isActive,
      limit: recent.limit,
    },
  }
}

export function normalizeMarketHomeConfig(value: unknown): MarketHomeConfig {
  try {
    return validateMarketHomeConfig(value)
  } catch {
    return {
      ...DEFAULT_MARKET_HOME_CONFIG,
      popular: { ...DEFAULT_MARKET_HOME_CONFIG.popular },
      sourceExplorer: { ...DEFAULT_MARKET_HOME_CONFIG.sourceExplorer },
      categories: { ...DEFAULT_MARKET_HOME_CONFIG.categories },
      recent: { ...DEFAULT_MARKET_HOME_CONFIG.recent },
    }
  }
}

