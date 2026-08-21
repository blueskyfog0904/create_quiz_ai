import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export interface MarketItemListPriceSource {
  id: string
  pdfPrice: number
  hwpPrice: number
  zipPrice: number
}

type SamplePageRow = {
  item_id: string
  page_number: number
}

type PriceRow = {
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

export async function loadMarketItemListEnrichment(
  supabase: SupabaseClient,
  subject: WorkspaceSubject,
  items: MarketItemListPriceSource[]
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

  if (sampleError || subproductError || bundleError || legacyFileError || reviewError) {
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
  for (const row of (subproductData ?? []) as PriceRow[]) {
    addPrice(row.item_id, row.price_credits)
  }
  for (const row of (bundleData ?? []) as PriceRow[]) {
    addPrice(row.item_id, row.price_credits)
  }

  const itemsById = new Map(items.map((item) => [item.id, item]))
  for (const file of (legacyFileData ?? []) as LegacyFileRow[]) {
    const item = itemsById.get(file.item_id)
    if (!item) continue

    const price = file.asset_kind === 'pdf'
      ? item.pdfPrice
      : file.asset_kind === 'hwp'
        ? item.hwpPrice
        : item.zipPrice
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
