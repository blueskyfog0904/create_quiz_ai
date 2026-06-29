import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePath = new URL('../src/app/api/admin/market/items/[id]/sample-pages/route.ts', import.meta.url)
const route = existsSync(routePath) ? readFileSync(routePath, 'utf8') : ''

test('admin sample pages api is admin gated and supports draft item previews', () => {
  assert.ok(existsSync(routePath), 'admin sample pages route should exist')
  assert.match(route, /requireAdminUser/)
  assert.match(route, /is_admin/)
  assert.match(route, /resolveAdminWorkspaceSubject/)
  assert.match(route, /getMarketItemById/)
  assert.doesNotMatch(route, /getPublishedMarketItemById/)
})

test('admin sample pages api returns short lived signed jpg preview urls', () => {
  assert.match(route, /listActiveMarketItemSamplePagesWithSourceFileNames/)
  assert.match(route, /createSignedUrl/)
  assert.match(route, /ADMIN_SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 \* 5/)
  assert.match(route, /expiresAt/)
  assert.match(route, /pageNumber/)
  assert.match(route, /originalFileName/)
  assert.match(route, /source_original_file_name \?\? page\.original_file_name/)
  assert.match(route, /signedUrl/)
  assert.match(route, /fileSizeBytes/)
  assert.match(route, /widthPx/)
  assert.match(route, /heightPx/)
})
