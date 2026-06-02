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

test('market detail action panel renders bundle package and individual alternatives before legacy fallback', () => {
  assert.match(itemActions, /subproducts\?: MarketSubproductPublicSummary\[\]/)
  assert.match(itemActions, /bundleOption\?: MarketBundlePublicSummary \| null/)
  assert.match(itemActions, /renderV2PurchaseOptions/)
  assert.match(itemActions, /전체 패키지/)
  assert.match(itemActions, /전체 포함/)
  assert.match(itemActions, /포함 자료/)
  assert.match(itemActions, /개별 자료 선택 구매/)
  assert.match(itemActions, /이 자료만 구매/)
  assert.match(itemActions, /setPendingV2PurchaseIntent\(null\)/)
  assert.match(itemActions, /purchaseType: 'subproduct'/)
  assert.match(itemActions, /purchaseType: 'bundle'/)
  assert.match(itemActions, /download\?fileId=\$\{fileId\}/)
})

test('market detail action buttons are responsive for sample and purchase actions', () => {
  assert.match(itemActions, /MARKET_ACTION_BUTTON_CLASS/)
  assert.match(itemActions, /w-full/)
  assert.match(itemActions, /sm:w-44/)
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

test('market detail names v2 download buttons by subproduct title', () => {
  assert.match(itemActions, /const downloadLabel = `\$\{file\.subproductTitle\} 다운로드`/)
  assert.match(itemActions, /aria-label=\{downloadLabel\}/)
  assert.match(itemActions, /\{downloadLabel\}/)
  assert.doesNotMatch(itemActions, /aria-label=\{`\$\{file\.fileTypeLabel\} 다운로드`\}/)
  assert.doesNotMatch(itemActions, /\{file\.fileTypeLabel\} 다운로드/)
})

test('market detail resolves v2 subproduct labels from category names first', () => {
  assert.match(marketItemsServer, /function resolveMarketSubproductDisplayTitle/)
  assert.match(marketItemsServer, /resolveMarketSubproductDisplayTitle\(category\?\.name, subproduct\.title\)/)
  assert.match(marketItemsServer, /resolveMarketSubproductDisplayTitle\(categoryMap\.get\(subproduct\.category_id\), subproduct\.title\)/)
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
