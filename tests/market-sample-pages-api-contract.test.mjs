import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePath = new URL('../src/app/api/market/items/[itemId]/sample-pages/route.ts', import.meta.url)
const route = existsSync(routePath) ? readFileSync(routePath, 'utf8') : ''
const itemPage = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx', import.meta.url),
  'utf8'
)
const itemActions = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
  'utf8'
)

test('market sample pages api returns ordered signed jpg preview urls', () => {
  assert.ok(existsSync(routePath), 'sample pages route should exist')
  assert.match(route, /listActiveMarketItemSamplePages/)
  assert.match(route, /getPublishedMarketItemById/)
  assert.match(route, /createSignedUrl/)
  assert.match(route, /signedUrl/)
  assert.match(route, /pageNumber/)
  assert.match(route, /widthPx/)
  assert.match(route, /heightPx/)
})

test('market sample pages api exposes ttl and file size metadata for client caching', () => {
  assert.match(route, /SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS = 60 \* 5/)
  assert.match(route, /expiresAt/)
  assert.match(route, /fileSizeBytes/)
  assert.match(route, /file_size_bytes/)
  assert.match(route, /createSignedUrl\(page\.storage_path, SAMPLE_PAGE_SIGNED_URL_TTL_SECONDS\)/)
})

test('market item detail uses generated sample page preview instead of sample pdf download', () => {
  assert.match(itemPage, /listActiveMarketItemSamplePages/)
  assert.match(itemPage, /hasSamplePages/)
  assert.match(itemActions, /MarketSamplePreviewDialog/)
  assert.match(itemActions, /샘플 미리보기/)
  assert.match(itemActions, /1~3페이지 JPG/)
  assert.doesNotMatch(itemActions, /title="샘플 PDF"/)
  assert.doesNotMatch(itemActions, /buildDownloadUrl\(itemId, 'sample'\)/)
})
