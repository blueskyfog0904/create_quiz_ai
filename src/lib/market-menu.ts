import type { Database } from '@/types/supabase'
import type {
  HeaderMenuChildItem,
  HeaderNavigationConfig,
} from '@/lib/header-navigation'
import {
  mergeDbManagedChildrenIntoHeaderConfig,
  type DbManagedChildrenSourceMode,
} from '@/lib/db-managed-header'

export type MarketMenuEntry = Database['public']['Tables']['market_menu_entries']['Row']

export interface MarketMenuEntryAdminRow extends MarketMenuEntry {}

export type MarketChildrenSourceMode = DbManagedChildrenSourceMode

export const MARKET_PARENT_FALLBACK_ID = 'menu-market'
export const MARKET_PARENT_FALLBACK_TITLE = '문제마켓'
export const MARKET_PARENT_HREF = '/market'

export function buildMarketMenuHref(entry: Pick<MarketMenuEntry, 'slug'>) {
  return `/library/purchased?marketSlug=${encodeURIComponent(entry.slug)}`
}

export function buildMarketHeaderChildItem(entry: MarketMenuEntry): HeaderMenuChildItem {
  return {
    id: `market-entry-${entry.entry_key}`,
    title: entry.title,
    href: buildMarketMenuHref(entry),
    isActive: entry.is_active && entry.is_visible && entry.deleted_at === null,
  }
}

export function mergeMarketEntriesIntoHeaderConfig(
  baseConfig: HeaderNavigationConfig,
  marketEntries: MarketMenuEntry[],
  sourceMode: MarketChildrenSourceMode = 'hybrid_fallback'
): HeaderNavigationConfig {
  const entries = marketEntries
    .filter((entry) => entry.deleted_at === null)
    .filter((entry) => sourceMode !== 'db_authoritative' || (entry.is_active && entry.is_visible))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ko'))

  return mergeDbManagedChildrenIntoHeaderConfig(
    baseConfig,
    entries.map(buildMarketHeaderChildItem),
    {
      parentHref: MARKET_PARENT_HREF,
      fallbackId: MARKET_PARENT_FALLBACK_ID,
      fallbackTitle: MARKET_PARENT_FALLBACK_TITLE,
    },
    sourceMode
  )
}
