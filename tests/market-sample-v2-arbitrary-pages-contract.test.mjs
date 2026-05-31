import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const generator = readFileSync(new URL('../src/lib/market-pdf-sample-generator.ts', import.meta.url), 'utf8')
const adminProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('sample page parser accepts arbitrary comma separated pages with de-duplication', () => {
  assert.match(generator, /export function parseMarketSamplePageSelection/)
  assert.match(generator, /split\(/)
  assert.match(generator, /new Set/)
  assert.match(generator, /pageNumber < 1|pageNumber <= 0/)
  assert.match(generator, /maxPageCount/)
  assert.match(generator, /MAX_GENERATED_SAMPLE_PAGE_COUNT/)
  assert.doesNotMatch(generator, /Number\.parseInt/)
})

test('admin client renders selected page numbers instead of only first three pages', () => {
  assert.match(adminProductsClient, /parseMarketSamplePageSelection\(samplePageSelection,\s*pdf\.numPages\)/)
  assert.match(adminProductsClient, /for \(const pageNumber of pageNumbers\)/)
  assert.match(adminProductsClient, /pageNumber/)
  assert.doesNotMatch(adminProductsClient, /for \(let pageNumber = 1; pageNumber <= pageCount; pageNumber \+= 1\)/)
})
