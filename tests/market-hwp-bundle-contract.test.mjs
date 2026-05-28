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

test('market purchase helpers treat paid asset kinds as exact-match entitlements', () => {
  assert.match(marketPurchase, /isMarketAssetCoveredByPurchaseKind/)
  assert.doesNotMatch(marketPurchase, /downloadAssetKind === 'pdf' && purchasedAssetKind === 'hwp'/)
  assert.match(marketPurchase, /return downloadAssetKind === purchasedAssetKind/)
  assert.match(marketPurchase, /getMarketPaidAssetLabel[\s\S]+HWP & PDF/)
})

test('listboard effective ownership does not treat hwp purchase as owning pdf', () => {
  assert.match(listboardServer, /pdfOwned/)
  assert.doesNotMatch(listboardServer, /ownership\.has\(`\$\{item\.id\}:pdf`\) \|\| ownership\.has\(`\$\{item\.id\}:hwp`\)/)
  assert.match(listboardServer, /const pdfOwned = ownership\.has\(`\$\{item\.id\}:pdf`\)/)
})

test('legacy bundle normalization remains exact-match and listboard batch purchase is deprecated', () => {
  assert.match(marketPurchase, /normalizeMarketBundleSelections/)
  assert.match(batchRoute, /BATCH_PURCHASE_DEPRECATED/)
  assert.doesNotMatch(batchRoute, /normalizeMarketBundleSelections\(parsed\.data\.selections\)/)
  assert.doesNotMatch(marketPurchase, /assetKind === 'pdf' && hwpItemIds\.has/)
})

test('download route uses shared exact-match entitlement helper so zip stays independent', () => {
  assert.match(downloadRoute, /isMarketAssetCoveredByPurchaseKind/)
  assert.match(downloadRoute, /getMarketPurchaseKindsToCheck/)
  assert.doesNotMatch(marketPurchase, /assetKind === 'pdf'[\s\S]+\['pdf', 'hwp'\]/)
  assert.match(marketPurchase, /return \[assetKind\]/)
  assert.match(marketPurchase, /return \[assetKind\]/)
})

test('ui labels hwp paid option as pdf and hwp bundle on list and detail pages', () => {
  assert.match(listboardClient, /HWP & PDF/)
  assert.match(itemActions, /HWP & PDF/)
  assert.match(listboardClient, /whitespace-nowrap/)
  assert.match(listboardClient, /min-w-\[410px\]/)
  assert.match(listboardClient, /flex-nowrap/)
})
