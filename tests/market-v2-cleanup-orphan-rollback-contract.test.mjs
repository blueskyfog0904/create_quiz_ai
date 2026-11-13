import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const cleanupHelper = readFileSync(
  new URL('../src/lib/market-item-cleanup.ts', import.meta.url),
  'utf8'
)

test('market item cleanup includes v2 subproduct paid file storage objects', () => {
  assert.match(cleanupHelper, /listMarketSubproductFilesForAdmin/)
  assert.match(cleanupHelper, /const subproductFiles = await listMarketSubproductFilesForAdmin\(itemId, undefined, workspaceSubject\)/)
  assert.match(cleanupHelper, /for \(const file of subproductFiles\)/)
  assert.match(cleanupHelper, /addStorageTarget\(targets, file\.storage_bucket, file\.storage_path\)/)
})

test('market item cleanup blocks hard delete when v2 purchase or entitlement history exists', () => {
  // 이력 판정은 구매·권리·다운로드·환불·후기 7개 표를 모두 본다
  for (const table of [
    'market_purchases',
    'market_download_events',
    'market_purchase_orders',
    'market_purchase_lines',
    'market_entitlements',
    'market_refund_requests',
    'market_item_reviews',
  ]) {
    assert.match(cleanupHelper, new RegExp(`'${table}'`))
  }
  assert.match(cleanupHelper, /MARKET_ITEM_HISTORY_TABLES\.map\(\(table\) =>/)
  assert.match(cleanupHelper, /itemsWithHistory\.add\(row\.item_id\)/)
})

