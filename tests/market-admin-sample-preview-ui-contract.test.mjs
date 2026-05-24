import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const adminProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)
const dialogPath = new URL('../src/app/(admin)/admin/market/products/admin-market-sample-preview-dialog.tsx', import.meta.url)
const dialog = existsSync(dialogPath) ? readFileSync(dialogPath, 'utf8') : ''

test('admin product upload area exposes a generated sample preview action', () => {
  assert.match(adminProductsClient, /AdminMarketSamplePreviewDialog/)
  assert.match(adminProductsClient, /isSamplePreviewOpen/)
  assert.match(adminProductsClient, /samplePreviewItemId/)
  assert.match(adminProductsClient, /샘플 확인/)
  assert.match(adminProductsClient, /샘플 생성 중/)
  assert.match(adminProductsClient, /PDF 없음/)
  assert.match(adminProductsClient, /activeFileMap\.get\('pdf'\)/)
  assert.match(adminProductsClient, /uploadingKinds\.includes\('pdf'\)/)
})

test('admin sample preview dialog fetches fresh admin signed sample urls', () => {
  assert.ok(existsSync(dialogPath), 'admin sample preview dialog should exist')
  assert.match(dialog, /\/api\/admin\/market\/items\/\$\{itemId\}\/sample-pages/)
  assert.match(dialog, /withAdminWorkspaceSubject/)
  assert.match(dialog, /cache: 'no-store'/)
  assert.match(dialog, /샘플 JPG 확인/)
  assert.match(dialog, /샘플 이미지를 불러오는 중입니다/)
  assert.match(dialog, /다시 불러오기/)
  assert.match(dialog, /aria-pressed/)
  assert.match(dialog, /page\.signedUrl/)
  assert.match(dialog, /<img/)
  assert.match(dialog, /fileSizeBytes/)
  assert.match(dialog, /widthPx/)
  assert.match(dialog, /heightPx/)
  assert.doesNotMatch(dialog, /new Map/)
})
