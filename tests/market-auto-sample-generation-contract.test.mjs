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

test('admin product uploads use v2 subproduct file slots plus separate sample pdf source', () => {
  assert.match(adminProductsClient, /MarketFileType/)
  assert.match(adminProductsClient, /fileTypes/)
  assert.match(adminProductsClient, /파일추가/)
  assert.doesNotMatch(adminProductsClient, /const MARKET_ASSET_KINDS = \['sample', 'pdf', 'hwp', 'zip'\] as const/)
  assert.match(adminProductsClient, /샘플 이미지 생성/)
  assert.match(adminProductsClient, /selectedSampleSourceFile/)
  assert.match(adminProductsClient, /formData\.append\('draftToken', sampleDraftToken\)/)
  assert.match(adminProductsClient, /\/samples\/commit/)
  assert.match(adminProductsClient, /zipPrice/)
  assert.doesNotMatch(adminProductsClient, /PDF 업로드 시 첫 1~3페이지가 JPG 샘플로 자동 생성됩니다/)
  assert.match(adminProductsClient, /샘플 JPG/)
})

test('admin product upload route keeps paid pdf uploads separate from sample generation', () => {
  assert.match(adminUploadRoute, /assetKindValue !== 'pdf' && assetKindValue !== 'hwp' && assetKindValue !== 'zip'/)
  assert.doesNotMatch(adminUploadRoute, /assetKindValue !== 'sample' && assetKindValue !== 'pdf' && assetKindValue !== 'hwp' && assetKindValue !== 'zip'/)
  assert.doesNotMatch(adminUploadRoute, /generateMarketPdfSamplePages/)
  assert.doesNotMatch(adminUploadRoute, /replaceMarketItemSamplePages/)
  assert.doesNotMatch(adminUploadRoute, /samplePageCount/)
  assert.doesNotMatch(adminUploadRoute, /sampleGenerationStatus/)
  assert.match(adminUploadRoute, /savedFile/)
})

test('market storage has dedicated sample page path builders and paid pdf hwp zip uploads', () => {
  assert.match(marketStorage, /buildMarketSamplePageStoragePath/)
  assert.match(marketStorage, /sample-pages/)
  assert.match(marketStorage, /image\/jpeg/)
  assert.match(marketStorage, /assetKind:\s*'pdf' \| 'hwp' \| 'zip'/)
  assert.match(marketStorage, /buildMarketManualSamplePageStoragePath/)
  assert.match(marketStorage, /MAX_SAMPLE_SOURCE_PDF_SIZE/)
})

test('pdf sample generator paints a white background before jpg export', () => {
  assert.match(sampleGenerator, /fillStyle = '#fff'/)
  assert.match(sampleGenerator, /fillRect\(0, 0, canvas\.width, canvas\.height\)/)
  assert.ok(
    sampleGenerator.indexOf('fillRect(0, 0, canvas.width, canvas.height)') <
      sampleGenerator.indexOf("toDataURL('image/jpeg', 0.9)"),
    'white background fill should happen before JPG export'
  )
})

test('pdf sample generator uses the original high quality jpg export', () => {
  assert.match(sampleGenerator, /getViewport\(\{ scale: 1\.5 \}\)/)
  assert.match(sampleGenerator, /toDataURL\('image\/jpeg', 0\.9\)/)
  assert.doesNotMatch(sampleGenerator, /MARKET_SAMPLE_PAGE_TARGET_BYTES/)
  assert.doesNotMatch(sampleGenerator, /selectSampleJpegDataUrl/)
  assert.doesNotMatch(sampleGenerator, /sizeBytes <= targetBytes/)
})
