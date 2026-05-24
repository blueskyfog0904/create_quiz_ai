import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const helperPath = new URL('../src/lib/market-item-cleanup.ts', import.meta.url)
const helper = existsSync(helperPath) ? readFileSync(helperPath, 'utf8') : ''
const sampleHelper = readFileSync(new URL('../src/lib/market-sample-pages-server.ts', import.meta.url), 'utf8')
const itemRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/route.ts', import.meta.url), 'utf8')


test('market item cleanup helper collects exact file and sample page storage keys', () => {
  assert.ok(existsSync(helperPath), 'market item cleanup helper should exist')
  assert.match(helper, /collectMarketItemStorageTargets/)
  assert.match(helper, /listMarketItemFiles\(itemId, true, workspaceSubject\)/)
  assert.match(helper, /listMarketItemSamplePagesForCleanup\(itemId, workspaceSubject\)/)
  assert.match(helper, /storage_bucket/)
  assert.match(helper, /storage_path/)
  assert.match(helper, /new Set/)
  assert.doesNotMatch(helper, /sample-pages\/\*/)
  assert.doesNotMatch(helper, /\.list\(/)
})

test('sample page helper exposes cleanup listing before cascade delete', () => {
  assert.match(sampleHelper, /export async function listMarketItemSamplePagesForCleanup/)
  assert.match(sampleHelper, /from\('market_item_sample_pages'\)/)
  assert.match(sampleHelper, /eq\('item_id', itemId\)/)
})

test('hard delete route delegates to the shared cleanup helper instead of deleting files only', () => {
  assert.match(itemRoute, /hardDeleteMarketItemWithAssets/)
  assert.doesNotMatch(itemRoute, /const storageTargets = new Map/)
  assert.doesNotMatch(itemRoute, /adminSupabase\.storage\.from\(bucket\)\.remove/)
})
