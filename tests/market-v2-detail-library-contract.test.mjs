import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const itemPage = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx', import.meta.url),
  'utf8'
)
const itemActions = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
  'utf8'
)
const libraryClient = readFileSync(
  new URL('../src/app/(dashboard)/library/market/market-library-client.tsx', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)

test('market detail page loads v2 subproduct and bundle summaries for the action panel', () => {
  assert.match(itemPage, /listMarketSubproductPublicSummaries/)
  assert.match(itemPage, /getMarketBundlePublicSummary/)
  assert.match(itemPage, /listMarketSubproductDownloadFilesForUser/)
  assert.match(itemPage, /subproducts=\{subproducts\}/)
  assert.match(itemPage, /bundleOption=\{bundleOption\}/)
  assert.match(itemPage, /downloadFiles=\{downloadFiles\}/)
})

test('market detail action panel renders subproduct cards and bundle card before legacy fallback', () => {
  assert.match(itemActions, /subproducts\?: MarketSubproductPublicSummary\[\]/)
  assert.match(itemActions, /bundleOption\?: MarketBundlePublicSummary \| null/)
  assert.match(itemActions, /renderV2PurchaseOptions/)
  assert.match(itemActions, /전체 한번에 구매하기/)
  assert.match(itemActions, /전체 한번에 구매하기로 구매시 모든 서브상품을 다운받을 수 있습니다\./)
  assert.match(itemActions, /\{subproduct\.title\} 구매하기/)
  assert.match(itemActions, /setPendingV2PurchaseIntent\(null\)/)
  assert.match(itemActions, /purchaseType: 'subproduct'/)
  assert.match(itemActions, /purchaseType: 'bundle'/)
  assert.match(itemActions, /download\?fileId=\$\{fileId\}/)
})

test('market detail action buttons use one fixed width for sample and purchase actions', () => {
  assert.match(itemActions, /MARKET_ACTION_BUTTON_CLASS/)
  assert.match(itemActions, /w-44/)
  assert.match(itemActions, /MARKET_PRIMARY_BUTTON_CLASS/)
  assert.match(itemActions, /MARKET_OUTLINE_BUTTON_CLASS/)
})

test('market detail uses smart indigo action buttons and file option icons', () => {
  assert.match(itemActions, /bg-indigo-600/)
  assert.match(itemActions, /hover:bg-indigo-700/)
  assert.match(itemActions, /active:bg-indigo-800/)
  assert.match(itemActions, /border-indigo-500/)
  assert.match(itemActions, /text-indigo-600/)
  assert.match(itemActions, /focus-visible:ring-indigo-300/)
  assert.match(itemActions, /Eye/)
  assert.match(itemActions, /ShoppingCart/)
  assert.match(itemActions, /MarketOptionIcon/)
  assert.match(itemActions, /getSubproductIconKind/)
  assert.doesNotMatch(itemActions, /bg-rose-600/)
})

test('market detail uses soft status badges and green download actions', () => {
  assert.match(itemActions, /MARKET_BADGE_FREE_CLASS/)
  assert.match(itemActions, /MARKET_BADGE_AVAILABLE_CLASS/)
  assert.match(itemActions, /MARKET_BADGE_OWNED_CLASS/)
  assert.match(itemActions, /MARKET_DOWNLOAD_BUTTON_CLASS/)
  assert.match(itemActions, /className=\{MARKET_BADGE_FREE_CLASS\}>무료/)
  assert.match(itemActions, /className=\{MARKET_BADGE_AVAILABLE_CLASS\}>미구매/)
  assert.match(itemActions, /className=\{MARKET_BADGE_OWNED_CLASS\}>구매 완료/)
  assert.match(itemActions, /Download/)
  assert.match(itemActions, /buttonClassName\?: string/)
  assert.match(itemActions, /buttonClassName \?\?/)
  assert.match(itemActions, /className=\{MARKET_DOWNLOAD_BUTTON_CLASS\}/)
  assert.match(itemActions, /buttonClassName=\{ownsPdf \? MARKET_DOWNLOAD_BUTTON_CLASS : undefined\}/)
  assert.match(itemActions, /buttonClassName=\{ownsHwp \? MARKET_DOWNLOAD_BUTTON_CLASS : undefined\}/)
  assert.match(itemActions, /buttonClassName=\{ownsZip \? MARKET_DOWNLOAD_BUTTON_CLASS : undefined\}/)
  assert.match(itemActions, /buildV2DownloadUrl\(itemId, file\.id\)/)
  const downloadClassUses = itemActions.match(/MARKET_DOWNLOAD_BUTTON_CLASS/g) ?? []
  assert.ok(downloadClassUses.length >= 5)
})

test('market library keeps v2 entitlement data source but sends users to detail for downloads', () => {
  assert.match(marketItemsServer, /market_entitlements/)
  assert.match(marketItemsServer, /v2DownloadFiles/)
  assert.match(marketItemsServer, /listMarketSubproductDownloadFilesForUser/)
  assert.match(itemActions, /buildV2DownloadUrl\(itemId, file\.id\)/)
  assert.doesNotMatch(libraryClient, /file\.downloadUrl/)
  assert.doesNotMatch(libraryClient, /v2OwnedLabels/)
  assert.doesNotMatch(libraryClient, /서브상품\/전체구매/)
})
