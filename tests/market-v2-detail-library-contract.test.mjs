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
  assert.match(itemActions, /w-40/)
  assert.match(itemActions, /MARKET_PURCHASE_BUTTON_CLASS/)
})

test('market library includes v2 entitlements and download buttons alongside legacy rows', () => {
  assert.match(marketItemsServer, /market_entitlements/)
  assert.match(marketItemsServer, /v2DownloadFiles/)
  assert.match(marketItemsServer, /listMarketSubproductDownloadFilesForUser/)
  assert.match(libraryClient, /v2DownloadFiles/)
  assert.match(libraryClient, /서브상품\/전체구매/)
  assert.match(libraryClient, /file\.downloadUrl/)
})
