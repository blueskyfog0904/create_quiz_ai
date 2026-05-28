import type { MarketPaidAssetKind } from '@/lib/market-purchase'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export interface LegacyMarketBackfillItem {
  id: string
  workspace_subject: WorkspaceSubject
  pdf_price: number
  hwp_price: number
  zip_price: number
}

export interface LegacyMarketBackfillFile {
  item_id: string
  asset_kind: MarketPaidAssetKind
  is_active: boolean
  deleted_at: string | null
}

export interface LegacyMarketBackfillPurchase {
  id: string
  user_id: string
  item_id: string
  asset_kind: MarketPaidAssetKind
  status: string
  workspace_subject: WorkspaceSubject
}

export interface MarketSubproductBackfillDryRunInput {
  items: LegacyMarketBackfillItem[]
  files: LegacyMarketBackfillFile[]
  purchases: LegacyMarketBackfillPurchase[]
}

export interface MarketSubproductBackfillDryRunReport {
  dryRun: true
  wouldCreateSubproducts: number
  wouldCreateFiles: number
  wouldCreateEntitlements: number
  skippedItems: Array<{ itemId: string; reason: string }>
  subproductCategories: Record<'legacy_pdf' | 'legacy_hwp_bundle' | 'legacy_zip', number>
}

const LEGACY_CATEGORY_BY_ASSET_KIND: Record<MarketPaidAssetKind, 'legacy_pdf' | 'legacy_hwp_bundle' | 'legacy_zip'> = {
  pdf: 'legacy_pdf',
  hwp: 'legacy_hwp_bundle',
  zip: 'legacy_zip',
}

function hasPositiveLegacyPrice(item: LegacyMarketBackfillItem, assetKind: MarketPaidAssetKind) {
  if (assetKind === 'pdf') return item.pdf_price > 0
  if (assetKind === 'hwp') return item.hwp_price > 0
  return item.zip_price > 0
}

export function buildMarketSubproductBackfillDryRunReport(
  input: MarketSubproductBackfillDryRunInput
): MarketSubproductBackfillDryRunReport {
  const activeFileKeys = new Set(
    input.files
      .filter((file) => file.is_active && file.deleted_at === null)
      .map((file) => `${file.item_id}:${file.asset_kind}`)
  )
  const report: MarketSubproductBackfillDryRunReport = {
    dryRun: true,
    wouldCreateSubproducts: 0,
    wouldCreateFiles: 0,
    wouldCreateEntitlements: 0,
    skippedItems: [],
    subproductCategories: {
      legacy_pdf: 0,
      legacy_hwp_bundle: 0,
      legacy_zip: 0,
    },
  }

  for (const item of input.items) {
    let itemHasBackfillTarget = false

    for (const assetKind of ['pdf', 'hwp', 'zip'] as MarketPaidAssetKind[]) {
      const fileKey = `${item.id}:${assetKind}`
      if (!hasPositiveLegacyPrice(item, assetKind) || !activeFileKeys.has(fileKey)) {
        continue
      }

      itemHasBackfillTarget = true
      report.wouldCreateSubproducts += 1
      report.wouldCreateFiles += 1
      report.subproductCategories[LEGACY_CATEGORY_BY_ASSET_KIND[assetKind]] += 1
    }

    if (!itemHasBackfillTarget) {
      report.skippedItems.push({ itemId: item.id, reason: 'no_active_paid_legacy_file' })
    }
  }

  const completedPurchaseKeys = new Set<string>()
  for (const purchase of input.purchases) {
    if (purchase.status !== 'completed') {
      continue
    }

    const fileKey = `${purchase.item_id}:${purchase.asset_kind}`
    if (!activeFileKeys.has(fileKey)) {
      continue
    }

    completedPurchaseKeys.add(`${purchase.user_id}:${purchase.item_id}:${purchase.asset_kind}`)
  }

  report.wouldCreateEntitlements = completedPurchaseKeys.size
  return report
}
