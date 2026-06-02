import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const downloadRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const marketRefunds = readFileSync(new URL('../src/lib/market-refunds.ts', import.meta.url), 'utf8')

test('v2 download route blocks pending refund requests before signed URL issuance', () => {
  assert.match(downloadRoute, /hasPendingMarketRefundRequestForTarget/)
  assert.match(downloadRoute, /PENDING_REFUND/)
  assert.match(downloadRoute, /환불 요청이 접수되어 심사 중입니다/)
})

test('v2 download route records refund-relevant download event after signed URL success', () => {
  assert.match(downloadRoute, /recordMarketV2DownloadEvent/)
  assert.match(downloadRoute, /event_target_type: 'subproduct_file'/)
  assert.match(downloadRoute, /subproduct_file_id: file\.id/)
  assert.match(downloadRoute, /order_id: entitlement\.source_order_id/)
  assert.match(downloadRoute, /entitlement_id: entitlement\.id/)
})

test('legacy download route also blocks pending refund requests', () => {
  assert.match(downloadRoute, /targetKind: 'legacy_purchase'/)
  assert.match(downloadRoute, /legacyPurchaseId: purchaseId/)
})

test('market server exposes v2 download event insert helper and pending refund checker', () => {
  assert.match(marketItemsServer, /export async function recordMarketV2DownloadEvent/)
  assert.match(marketItemsServer, /event_target_type: 'subproduct_file'/)
  assert.match(marketItemsServer, /subproduct_file_id/)
  assert.match(marketRefunds, /export async function hasPendingMarketRefundRequestForTarget/)
})
