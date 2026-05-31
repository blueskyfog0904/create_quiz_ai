import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePath = new URL('../src/app/api/cron/market/cleanup-auto-upload-drafts/route.ts', import.meta.url)
const route = existsSync(routePath) ? readFileSync(routePath, 'utf8') : ''
const helperPath = new URL('../src/lib/market-item-cleanup.ts', import.meta.url)
const helper = existsSync(helperPath) ? readFileSync(helperPath, 'utf8') : ''


test('auto-upload draft cleanup route is server-only, cron-secret gated, and dry-run capable', () => {
  assert.ok(existsSync(routePath), 'cleanup cron route should exist')
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /Authorization/)
  assert.match(route, /dryRun/)
  assert.match(route, /olderThanHours/)
  assert.match(route, /limit/)
  assert.match(route, /cleanupAutoUploadDraftMarketItems/)
  assert.match(route, /cleanupRemovedManualSampleUploadTargets/)
  assert.match(route, /manualSampleUploadTargets/)
})

test('cleanup helper uses positive allowlist and purchase/download exclusions', () => {
  assert.ok(existsSync(helperPath), 'market item cleanup helper should exist')
  assert.match(helper, /draft_source/)
  assert.match(helper, /auto_upload/)
  assert.match(helper, /eq\('status', 'draft'\)/)
  assert.match(helper, /eq\('draft_source', 'auto_upload'\)/)
  assert.match(helper, /market_purchases/)
  assert.match(helper, /market_download_events/)
  assert.match(helper, /dryRun/)
  assert.match(helper, /limit/)
})
