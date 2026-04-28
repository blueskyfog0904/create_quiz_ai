import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketPurchase = readFileSync(
  new URL('../src/lib/market-purchase.ts', import.meta.url),
  'utf8'
)
const listboardServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)
const listboardClient = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/market-listboard-client.tsx', import.meta.url),
  'utf8'
)
const itemActions = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
  'utf8'
)
const downloadRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url),
  'utf8'
)
const batchRoute = readFileSync(
  new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url),
  'utf8'
)

test('market purchase helpers define hwp as a pdf and hwp bundle while pdf remains standalone', () => {
  assert.match(marketPurchase, /isMarketAssetCoveredByPurchaseKind/)
  assert.match(marketPurchase, /downloadAssetKind === 'pdf' && purchasedAssetKind === 'hwp'/)
  assert.match(marketPurchase, /getMarketPaidAssetLabel[\s\S]+PDF & HWP/)
})

test('listboard effective ownership treats hwp purchase as owning pdf too', () => {
  assert.match(listboardServer, /pdfOwned/)
  assert.match(listboardServer, /ownership\.has\(`\$\{item\.id\}:pdf`\) \|\| ownership\.has\(`\$\{item\.id\}:hwp`\)/)
})

test('batch purchase normalizes pdf plus hwp selections to only the bundle target', () => {
  assert.match(marketPurchase, /normalizeMarketBundleSelections/)
  assert.match(batchRoute, /normalizeMarketBundleSelections\(parsed\.data\.selections\)/)
})

test('download route checks hwp ownership as fallback for pdf downloads', () => {
  assert.match(downloadRoute, /isMarketAssetCoveredByPurchaseKind/)
  assert.match(downloadRoute, /assetKind === 'pdf'/)
  assert.match(downloadRoute, /'hwp'/)
})

test('ui labels hwp paid option as pdf and hwp bundle on list and detail pages', () => {
  assert.match(listboardClient, /PDF & HWP/)
  assert.match(itemActions, /PDF & HWP/)
})
