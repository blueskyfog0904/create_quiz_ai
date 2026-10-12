import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const MARKET_HOME_SETTING_KEY = 'market_home'

export const MARKET_HOME_LIMITS = {
  popular: { min: 1, max: 24 },
  rankingWindowDays: { min: 1, max: 90 },
  recent: { min: 1, max: 24 },
} as const

export interface MarketHomeConfig {
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

export const DEFAULT_MARKET_HOME_CONFIG: MarketHomeConfig = {
  version: 1,
  popular: {
    isActive: true,
    limit: 12,
    rankingWindowDays: 30,
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

export interface MarketHomeData {
  subject: WorkspaceSubject
  config: MarketHomeConfig
  popular: MarketHomePopularItem[]
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

export function validateMarketHomeConfig(input: unknown): MarketHomeConfig {
  if (!isRecord(input)) {
    throw new Error('market home config must be an object')
  }
  // 삭제된 '문제마켓 카테고리' 설정(categories)이 남은 예전 값도 받아들여, 엄격 검사 실패로
  // 인기·최근 설정까지 기본값으로 초기화되지 않게 한다. 복사본에서만 떼어 내 입력값은 그대로 둔다.
  const value = { ...input }
  delete value.categories
  assertExactKeys(value, ['version', 'popular', 'recent'], 'config')
  if (value.version !== 1) {
    throw new Error('config.version must be 1')
  }

  const popular = value.popular
  const recent = value.recent
  if (!isRecord(popular) || !isRecord(recent)) {
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
      recent: { ...DEFAULT_MARKET_HOME_CONFIG.recent },
    }
  }
}
