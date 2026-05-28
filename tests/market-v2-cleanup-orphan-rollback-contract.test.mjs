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
  assert.match(cleanupHelper, /market_purchase_orders/)
  assert.match(cleanupHelper, /market_entitlements/)
  assert.match(cleanupHelper, /const v2HistoryIds/)
  assert.match(cleanupHelper, /\.\.\.\(orders \?\? \[\]\)\.map\(\(order\) => order\.item_id\)/)
  assert.match(cleanupHelper, /\.\.\.\(entitlements \?\? \[\]\)\.map\(\(entitlement\) => entitlement\.item_id\)/)
})

