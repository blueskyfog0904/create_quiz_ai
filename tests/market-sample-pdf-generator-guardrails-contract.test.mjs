import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const generator = readFileSync(new URL('../src/lib/market-pdf-sample-generator.ts', import.meta.url), 'utf8')
const storage = readFileSync(new URL('../src/lib/market-storage.ts', import.meta.url), 'utf8')
const sourceRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/sample-pages/source/route.ts', import.meta.url), 'utf8')

test('sample pdf upload and rendering define size pixel byte and timeout guardrails', () => {
  assert.match(storage, /MAX_SAMPLE_SOURCE_PDF_SIZE_BYTES|MAX_SAMPLE_SOURCE_PDF_SIZE/)
  assert.match(generator, /MAX_SAMPLE_PAGE_PIXELS/)
  assert.match(generator, /MAX_SAMPLE_PAGE_DIMENSION_PX/)
  assert.match(generator, /MAX_GENERATED_SAMPLE_PAGE_BYTES/)
  assert.match(generator, /MAX_GENERATED_SAMPLE_TOTAL_BYTES/)
  assert.match(generator, /PAGE_RENDER_TIMEOUT|RENDER_TIMEOUT|Promise\.race/)
  assert.match(sourceRoute, /MAX_SAMPLE_SOURCE_PDF_SIZE|assertSampleSourcePdfUploadIsAllowed/)
})
