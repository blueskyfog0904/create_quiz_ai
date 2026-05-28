import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const marketItemsServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)

const marketPurchase = readFileSync(
  new URL('../src/lib/market-purchase.ts', import.meta.url),
  'utf8'
)

const backfillPath = new URL('../src/lib/market-subproduct-backfill.ts', import.meta.url)
const backfillSource = existsSync(backfillPath) ? readFileSync(backfillPath, 'utf8') : ''

test('public v2 subproduct DTO masks paid file storage metadata', () => {
  assert.match(marketItemsServer, /export interface MarketSubproductPublicSummary/)
  assert.match(marketItemsServer, /export async function listMarketSubproductPublicSummaries/)
  assert.match(marketItemsServer, /fileTypes:/)
  assert.match(marketItemsServer, /fileCount:/)
  assert.match(marketItemsServer, /market_subproduct_files/)

  const helperStart = marketItemsServer.indexOf('export async function listMarketSubproductPublicSummaries')
  assert.notEqual(helperStart, -1)
  const helperSource = marketItemsServer.slice(helperStart, marketItemsServer.indexOf('\nexport ', helperStart + 1) === -1
    ? undefined
    : marketItemsServer.indexOf('\nexport ', helperStart + 1))

  assert.doesNotMatch(helperSource, /storage_path/)
  assert.doesNotMatch(helperSource, /original_file_name/)
  assert.doesNotMatch(helperSource, /checksum/)
  assert.doesNotMatch(helperSource, /file_size_bytes/)
})

test('v2 entitlement resolver grants only item, subproduct, or explicit file scope', () => {
  assert.match(marketPurchase, /export function isMarketSubproductFileCoveredByV2Entitlement/)
  assert.match(marketPurchase, /entitlement\.scope === 'item'/)
  assert.match(marketPurchase, /entitlement\.scope === 'subproduct'/)
  assert.match(marketPurchase, /entitlement\.scope === 'file'/)
  assert.match(marketPurchase, /entitlement\.subproduct_id === target\.subproductId/)
  assert.match(marketPurchase, /entitlement\.file_id === target\.fileId/)

  const resolverStart = marketPurchase.indexOf('export function isMarketSubproductFileCoveredByV2Entitlement')
  const resolverSource = marketPurchase.slice(resolverStart, marketPurchase.indexOf('\nexport ', resolverStart + 1) === -1
    ? undefined
    : marketPurchase.indexOf('\nexport ', resolverStart + 1))
  assert.doesNotMatch(resolverSource, /asset_kind/)
  assert.doesNotMatch(resolverSource, /hwp.*pdf|pdf.*hwp/i)
})

test('v2 backfill dry-run classifies legacy assets without writing entitlements', () => {
  assert.notEqual(backfillSource, '')
  assert.match(backfillSource, /export function buildMarketSubproductBackfillDryRunReport/)
  assert.match(backfillSource, /legacy_pdf/)
  assert.match(backfillSource, /legacy_hwp_bundle/)
  assert.match(backfillSource, /legacy_zip/)
  assert.match(backfillSource, /wouldCreateSubproducts/)
  assert.match(backfillSource, /wouldCreateFiles/)
  assert.match(backfillSource, /wouldCreateEntitlements/)
  assert.doesNotMatch(backfillSource, /\.insert\(/)
  assert.doesNotMatch(backfillSource, /\.upsert\(/)
  assert.doesNotMatch(backfillSource, /\.update\(/)
})
