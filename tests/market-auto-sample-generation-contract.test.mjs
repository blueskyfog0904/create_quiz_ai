import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const adminProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)
const adminUploadRoute = readFileSync(
  new URL('../src/app/api/admin/market/items/[id]/files/route.ts', import.meta.url),
  'utf8'
)
const marketStorage = readFileSync(
  new URL('../src/lib/market-storage.ts', import.meta.url),
  'utf8'
)
const sampleGenerator = readFileSync(
  new URL('../src/lib/market-pdf-sample-generator.ts', import.meta.url),
  'utf8'
)

test('admin product uploads expose only pdf and hwp manual upload slots', () => {
  assert.match(adminProductsClient, /const MARKET_ASSET_KINDS = \['pdf', 'hwp'\] as const/)
  assert.doesNotMatch(adminProductsClient, /const MARKET_ASSET_KINDS = \['sample', 'pdf', 'hwp'\] as const/)
  assert.doesNotMatch(adminProductsClient, /fileInputRefs[\s\S]*sample:\s*null/)
  assert.match(adminProductsClient, /PDF 업로드 시 첫 1~3페이지가 JPG 샘플로 자동 생성됩니다/)
  assert.match(adminProductsClient, /샘플 JPG/)
})

test('admin product upload route treats sample pages as a pdf-derived artifact', () => {
  assert.match(adminUploadRoute, /assetKindValue !== 'pdf' && assetKindValue !== 'hwp'/)
  assert.doesNotMatch(adminUploadRoute, /assetKindValue !== 'sample' && assetKindValue !== 'pdf' && assetKindValue !== 'hwp'/)
  assert.match(adminUploadRoute, /generateMarketPdfSamplePages/)
  assert.match(adminUploadRoute, /replaceMarketItemSamplePages/)
  assert.match(adminUploadRoute, /if \(assetKindValue === 'pdf'\)/)
  assert.match(adminUploadRoute, /samplePageCount/)
  assert.match(adminUploadRoute, /sampleGenerationStatus/)
})

test('market storage has a dedicated sample page path builder without widening paid asset uploads', () => {
  assert.match(marketStorage, /buildMarketSamplePageStoragePath/)
  assert.match(marketStorage, /sample-pages/)
  assert.match(marketStorage, /image\/jpeg/)
  assert.match(marketStorage, /assetKind:\s*'pdf' \| 'hwp'/)
})

test('pdf sample generator paints a white background before jpg export', () => {
  assert.match(sampleGenerator, /fillStyle = '#fff'/)
  assert.match(sampleGenerator, /fillRect\(0, 0, canvas\.width, canvas\.height\)/)
  assert.ok(
    sampleGenerator.indexOf('fillRect(0, 0, canvas.width, canvas.height)') <
      sampleGenerator.indexOf("targetCanvas.toDataURL('image/jpeg', jpegQuality)"),
    'white background fill should happen before JPG export'
  )
})

test('pdf sample generator targets about 100KB per JPG sample page', () => {
  assert.match(sampleGenerator, /const MARKET_SAMPLE_PAGE_TARGET_BYTES = 100 \* 1024/)
  assert.match(sampleGenerator, /const MARKET_SAMPLE_PAGE_JPEG_QUALITIES = \[/)
  assert.match(sampleGenerator, /const MARKET_SAMPLE_PAGE_RENDER_SCALES = \[/)
  assert.match(sampleGenerator, /selectSampleJpegDataUrl/)
  assert.match(sampleGenerator, /sizeBytes <= targetBytes/)
  assert.doesNotMatch(sampleGenerator, /toDataURL\('image\/jpeg', 0\.9\)/)
})
