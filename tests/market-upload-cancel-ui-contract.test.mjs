import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const adminProductsClient = readFileSync(new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url), 'utf8')


test('admin product form exposes a distinct cancel/delete action for auto-upload drafts', () => {
  assert.match(adminProductsClient, /등록 취소 및 파일 삭제/)
  assert.match(adminProductsClient, /임시 업로드 상태/)
  assert.match(adminProductsClient, /isAutoUploadDraft/)
  assert.match(adminProductsClient, /상품 등록을 완료하지 않고 업로드 파일을 삭제/)
})

test('cancel/delete action uses the same exact asset cleanup delete route', () => {
  assert.match(adminProductsClient, /handleArchive/)
  assert.match(adminProductsClient, /method:\s*'DELETE'/)
  assert.match(adminProductsClient, /등록 취소 및 파일 삭제했습니다|임시 업로드 파일을 삭제했습니다/)
})
