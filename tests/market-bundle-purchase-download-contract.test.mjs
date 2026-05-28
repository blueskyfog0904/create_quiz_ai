import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const downloadRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)
const marketPurchase = readFileSync(
  new URL('../src/lib/market-purchase.ts', import.meta.url),
  'utf8'
)

test('download route supports v2 fileId downloads in addition to legacy assetKind downloads', () => {
  assert.match(downloadRoute, /fileId/)
  assert.match(downloadRoute, /handleMarketV2Download/)
  assert.match(downloadRoute, /handleLegacyMarketDownload/)
  assert.match(downloadRoute, /getActiveMarketSubproductFileForDownload/)
  assert.match(downloadRoute, /findMarketSubproductFileV2Entitlement/)
})

test('bundle entitlement grants every active file on the item while subproduct entitlement is scoped', () => {
  assert.match(marketPurchase, /entitlement\.scope === 'item'/)
  assert.match(marketPurchase, /entitlement\.scope === 'subproduct'/)
  assert.match(marketPurchase, /entitlement\.subproduct_id === target\.subproductId/)
  assert.match(marketItemsServer, /export async function listMarketV2EntitlementsForItem/)
  assert.match(marketItemsServer, /scope, subproduct_id, file_id[\s\S]+status/)
})

test('v2 download never exposes storage path until entitlement has been checked', () => {
  const handlerStart = downloadRoute.indexOf('async function handleMarketV2Download')
  assert.notEqual(handlerStart, -1)
  const handlerSource = downloadRoute.slice(handlerStart, downloadRoute.indexOf('async function handleLegacyMarketDownload'))
  assert.match(handlerSource, /findMarketSubproductFileV2Entitlement/)
  assert.match(handlerSource, /if \(!entitlement\)/)
  assert.match(handlerSource, /createSignedUrl\(file\.storage_path/)
  assert.ok(handlerSource.indexOf('findMarketSubproductFileV2Entitlement') < handlerSource.indexOf('createSignedUrl(file.storage_path'))
})
