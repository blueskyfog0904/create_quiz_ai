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
const samplePagesServer = readFileSync(
  new URL('../src/lib/market-sample-pages-server.ts', import.meta.url),
  'utf8'
)
const sampleDialog = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx', import.meta.url),
  'utf8'
)

test('market sample pages api returns ordered signed jpg preview urls', () => {
  assert.ok(existsSync(routePath), 'sample pages route should exist')
  assert.match(route, /listActiveMarketItemSamplePagesWithSourceFileNames/)
  assert.match(route, /getPublishedMarketItemById/)
  assert.match(route, /createSignedUrl/)
  assert.match(route, /signedUrl/)
  assert.match(route, /id: page\.id/)
  assert.match(route, /pageNumber/)
  assert.match(route, /originalFileName/)
  assert.match(route, /source_original_file_name \?\? page\.original_file_name/)
  assert.match(route, /widthPx/)
  assert.match(route, /heightPx/)
})

test('market sample page helper resolves preview labels from source pdf names before generated jpg names', () => {
  assert.match(samplePagesServer, /source_original_file_name\?: string \| null/)
  assert.match(samplePagesServer, /listActiveMarketItemSamplePagesWithSourceFileNames/)
  assert.match(samplePagesServer, /market_item_files/)
  assert.match(samplePagesServer, /market_subproduct_files/)
  assert.match(samplePagesServer, /market_file_types/)
  assert.match(samplePagesServer, /getMarketSamplePageDisplayOriginalFileName/)
  assert.match(samplePagesServer, /sourceFileName \?\? fallbackPdfFileName \?\? page\.original_file_name/)
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
  assert.match(itemActions, /구매 전 PDF 첫 \$\{samplePageCount\}쪽을 확인할 수 있어요\./)
  assert.doesNotMatch(itemActions, /title="샘플 PDF"/)
  assert.doesNotMatch(itemActions, /buildDownloadUrl\(itemId, 'sample'\)/)
})

test('market sample preview dialog uses stable sample page ids for react keys', () => {
  assert.match(sampleDialog, /id: string/)
  assert.match(sampleDialog, /key=\{page\.id\}/)
  assert.match(sampleDialog, /originalFileName: string \| null/)
  assert.match(sampleDialog, /formatSamplePageLabel\(page\)/)
  assert.doesNotMatch(sampleDialog, /key=\{page\.pageNumber\}/)
})
