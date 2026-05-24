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

test('admin market product year select defaults blank forms to the current year before opening', () => {
  assert.match(marketProductsClient, /function getDefaultExamYear\(\)/)
  assert.match(marketProductsClient, /examYear: getDefaultExamYear\(\)/)
  assert.match(marketProductsClient, /const focusCurrentExamYear = \(\) => \{/)
  assert.match(marketProductsClient, /examYear: getDefaultExamYear\(\)/)
  assert.match(marketProductsClient, /onMouseDown=\{focusCurrentExamYear\}/)
  assert.match(marketProductsClient, /onFocus=\{focusCurrentExamYear\}/)
})

test('admin market product schedule controls are aligned in paired rows', () => {
  assert.match(
    marketProductsClient,
    /<div className="grid gap-4 md:grid-cols-2">\s*<div className="space-y-2">\s*<Label>연도<\/Label>[\s\S]*?<\/select>\s*<\/div>\s*<div className="space-y-2">\s*<Label>월<\/Label>/
  )
  assert.match(
    marketProductsClient,
    /<div className="grid gap-4 md:grid-cols-2">\s*<div className="space-y-2">\s*<Label>상태<\/Label>[\s\S]*?<\/select>\s*<\/div>\s*<div className="flex items-end">\s*<div className="flex h-10 w-full items-center justify-between rounded-md border px-3">[\s\S]*?활성화/
  )
})

test('admin market product price fields display comma-formatted credit values and save numeric values', () => {
  assert.match(marketProductsClient, /function formatCreditInputValue\(/)
  assert.match(marketProductsClient, /function parseCreditInputValue\(/)
  assert.match(marketProductsClient, /pdfPrice: formatCreditInputValue\(item\.pdf_price\)/)
  assert.match(marketProductsClient, /hwpPrice: formatCreditInputValue\(item\.hwp_price\)/)
  assert.match(marketProductsClient, /pdfPrice: parseCreditInputValue\(form\.pdfPrice\)/)
  assert.match(marketProductsClient, /hwpPrice: parseCreditInputValue\(form\.hwpPrice\)/)
  assert.match(
    marketProductsClient,
    /<Input\s+type="text"\s+inputMode="numeric"\s+value=\{form\.pdfPrice\}[\s\S]*?placeholder="예: 1,000"[\s\S]*?formatCreditInputValue\(event\.target\.value\)/
  )
  assert.match(
    marketProductsClient,
    /<Input\s+type="text"\s+inputMode="numeric"\s+value=\{form\.hwpPrice\}[\s\S]*?placeholder="예: 1,000"[\s\S]*?formatCreditInputValue\(event\.target\.value\)/
  )
})

test('admin generate product year options extend to 2050', () => {
  assert.match(generateProductsClient, /const MAX_EXAM_YEAR = 2050/)
  assert.match(generateProductsClient, /function buildExamYearOptions\(baseYear = MAX_EXAM_YEAR\)/)
  assert.match(generateProductsClient, /MAX_EXAM_YEAR[\s\S]*return buildExamYearOptions\(baseYear\)/)
  assert.doesNotMatch(generateProductsClient, /Number\(getDefaultExamDate\(\)\.examYear\)/)
})
