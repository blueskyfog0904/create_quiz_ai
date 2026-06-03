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

function extractBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `${start} should exist`)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(endIndex, -1, `${end} should exist after ${start}`)
  return source.slice(startIndex, endIndex)
}

test('admin product uploads use v2 subproduct file slots plus separate sample pdf source', () => {
  assert.match(adminProductsClient, /MarketFileType/)
  assert.match(adminProductsClient, /fileTypes/)
  assert.match(adminProductsClient, /파일추가/)
  assert.doesNotMatch(adminProductsClient, /const MARKET_ASSET_KINDS = \['sample', 'pdf', 'hwp', 'zip'\] as const/)
  assert.match(adminProductsClient, /샘플 이미지 생성/)
  assert.match(adminProductsClient, /selectedSampleSourceFile/)
  assert.match(adminProductsClient, /draftToken: sampleDraftToken/)
  assert.match(adminProductsClient, /uploadToSignedUrl/)
  assert.doesNotMatch(adminProductsClient, /formData\.append\('file', selectedSampleSourceFile\)/)
  assert.match(adminProductsClient, /\/samples\/commit/)
  assert.match(adminProductsClient, /zipPrice/)
  assert.doesNotMatch(adminProductsClient, /PDF 업로드 시 첫 1~3페이지가 JPG 샘플로 자동 생성됩니다/)
  assert.match(adminProductsClient, /샘플 JPG/)
})

test('admin sample pdf drop zone uses distinct colors when a source file is selected', () => {
  assert.match(adminProductsClient, /selectedSampleSourceFile\s*\?\s*'border-emerald-300 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100'/)
  assert.match(adminProductsClient, /selectedSampleSourceFile\s*\?\s*'text-emerald-700'\s*:\s*'text-slate-500'/)
  assert.match(adminProductsClient, /selectedSampleSourceFile\s*\?\s*'text-emerald-900'\s*:\s*'text-gray-900'/)
  assert.match(adminProductsClient, /selectedSampleSourceFile\s*\?\s*'text-emerald-700'\s*:\s*'text-gray-500'/)
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

test('admin client pdf renderer paints a white background before jpg export', () => {
  const renderer = extractBetween(
    adminProductsClient,
    'async function renderSamplePdfPages',
    'interface PersistFormOptions'
  )

  assert.match(renderer, /fillStyle = '#fff'/)
  assert.match(renderer, /fillRect\(0, 0, canvas\.width, canvas\.height\)/)
  assert.ok(
    renderer.indexOf('fillRect(0, 0, canvas.width, canvas.height)') <
      renderer.indexOf('canvasToJpegBlob(canvas, 0.9)'),
    'white background fill should happen before JPG export'
  )
})

test('admin client pdf renderer uses high quality jpg export', () => {
  assert.match(adminProductsClient, /getViewport\(\{ scale: 1\.5 \}\)/)
  assert.match(adminProductsClient, /canvas\.toBlob\([\s\S]*'image\/jpeg'[\s\S]*0\.9/)
  assert.doesNotMatch(sampleGenerator, /MARKET_SAMPLE_PAGE_TARGET_BYTES/)
  assert.doesNotMatch(sampleGenerator, /selectSampleJpegDataUrl/)
  assert.doesNotMatch(sampleGenerator, /sizeBytes <= targetBytes/)
  assert.doesNotMatch(sampleGenerator, /playwright|chromium\.launch/)
})
