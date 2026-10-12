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

test("admin market product year picker starts at '선택' and opens centered on the current year without picking it", () => {
  assert.match(marketProductsClient, /function getDefaultExamYear\(\)/)
  // 새 상품 폼은 연도 빈 값('선택')
  assert.match(marketProductsClient, /function buildEmptyForm\(\): MarketItemFormState \{[\s\S]*?examYear: '',/)
  // 펼치기만 해서는 값을 채우지 않는다(예전: 클릭하면 올해가 바로 들어갔다).
  assert.doesNotMatch(marketProductsClient, /focusCurrentExamYear/)
  // 목록은 고른 연도(없으면 올해)를 가운데로 스크롤해 보여 주고, 올해에 표시를 붙인다.
  assert.match(marketProductsClient, /data-year="\$\{form\.examYear \|\| currentExamYear\}"/)
  assert.match(marketProductsClient, /<div ref=\{scrollExamYearListToAnchor\} role="listbox" aria-label="연도"/)
  assert.match(marketProductsClient, /year === currentExamYear \?[^\n]*올해/)
  assert.match(marketProductsClient, /\{form\.examYear \|\| '선택'\}/)
  assert.match(marketProductsClient, /onClick=\{\(\) => pickExamYear\(''\)\}/)
})

test('admin market product schedule controls are aligned in paired rows', () => {
  assert.match(
    marketProductsClient,
    /<div className="grid gap-4 md:grid-cols-2">\s*<div className="space-y-2">\s*<Label>연도<\/Label>[\s\S]*?<\/Popover>\s*<\/div>\s*<div className="space-y-2">\s*<Label>월<\/Label>/
  )
  // 상태는 하단 버튼(공개하기·임시저장·더보기)으로만 정한다. 상태 선택칸·활성화 스위치는 두지 않는다.
  assert.doesNotMatch(marketProductsClient, /<Label>상태<\/Label>/)
  assert.doesNotMatch(marketProductsClient, /비활성화하면 노출되지 않습니다/)
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
