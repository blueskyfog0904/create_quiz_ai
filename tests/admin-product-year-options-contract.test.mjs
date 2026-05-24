import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

const generateProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/generate/products/generate-products-client.tsx', import.meta.url),
  'utf8'
)

test('admin market product year options extend to 2050', () => {
  assert.match(marketProductsClient, /const MAX_EXAM_YEAR = 2050/)
  assert.match(marketProductsClient, /function buildExamYearOptions\(baseYear = MAX_EXAM_YEAR\)/)
  assert.doesNotMatch(marketProductsClient, /buildExamYearOptions\(baseYear = new Date\(\)\.getFullYear\(\)\)/)
})

test('admin generate product year options extend to 2050', () => {
  assert.match(generateProductsClient, /const MAX_EXAM_YEAR = 2050/)
  assert.match(generateProductsClient, /function buildExamYearOptions\(baseYear = MAX_EXAM_YEAR\)/)
  assert.match(generateProductsClient, /MAX_EXAM_YEAR[\s\S]*return buildExamYearOptions\(baseYear\)/)
  assert.doesNotMatch(generateProductsClient, /Number\(getDefaultExamDate\(\)\.examYear\)/)
})
