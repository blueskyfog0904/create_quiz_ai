import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const generator = readFileSync(new URL('../src/lib/market-pdf-sample-generator.ts', import.meta.url), 'utf8')
const storage = readFileSync(new URL('../src/lib/market-storage.ts', import.meta.url), 'utf8')
const sourceRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/sample-pages/source/route.ts', import.meta.url), 'utf8')
const adminProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('sample pdf upload and rendering define size pixel byte and timeout guardrails', () => {
  assert.match(storage, /MAX_SAMPLE_SOURCE_PDF_SIZE_BYTES|MAX_SAMPLE_SOURCE_PDF_SIZE/)
  assert.match(generator, /MAX_SAMPLE_PAGE_PIXELS/)
  assert.match(generator, /MAX_SAMPLE_PAGE_DIMENSION_PX/)
  assert.match(generator, /MAX_GENERATED_SAMPLE_PAGE_COUNT/)
  assert.match(generator, /MAX_GENERATED_SAMPLE_PAGE_BYTES/)
  assert.match(generator, /MAX_GENERATED_SAMPLE_TOTAL_BYTES/)
  assert.match(generator, /MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH/)
  assert.match(generator, /SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS/)
  assert.match(generator, /SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS/)
  assert.match(generator, /dedupedPageNumbers\.length > MAX_GENERATED_SAMPLE_PAGE_COUNT/)
  assert.match(generator, /\^\\d\+\$/)
  assert.match(sourceRoute, /MAX_GENERATED_SAMPLE_PAGE_BYTES/)
  assert.match(sourceRoute, /MAX_GENERATED_SAMPLE_TOTAL_BYTES/)
  assert.match(sourceRoute, /MAX_GENERATED_SAMPLE_PAGE_COUNT/)
  assert.match(sourceRoute, /MAX_SAMPLE_ORIGINAL_FILE_NAME_LENGTH/)
  assert.match(adminProductsClient, /MAX_SAMPLE_PAGE_PIXELS/)
  assert.match(adminProductsClient, /MAX_SAMPLE_PAGE_DIMENSION_PX/)
  assert.match(adminProductsClient, /MAX_GENERATED_SAMPLE_PAGE_BYTES/)
  assert.match(adminProductsClient, /MAX_GENERATED_SAMPLE_TOTAL_BYTES/)
  assert.match(adminProductsClient, /Promise\.race/)
  assert.match(adminProductsClient, /SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS/)
  assert.match(adminProductsClient, /SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS/)
  assert.doesNotMatch(generator, /Buffer/)
  assert.doesNotMatch(generator, /playwright|chromium\.launch|page\.evaluate/)
})
