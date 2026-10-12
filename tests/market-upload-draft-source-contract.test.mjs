import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = readdirSync(migrationsDir).find((name) => name.includes('market_auto_upload_cleanup'))
const migration = migrationName ? readFileSync(join(migrationsDir.pathname, migrationName), 'utf8') : ''
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')
const adminItemsRoute = readFileSync(new URL('../src/app/api/admin/market/items/route.ts', import.meta.url), 'utf8')
const adminItemRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/route.ts', import.meta.url), 'utf8')
const adminProductsClient = readFileSync(new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url), 'utf8')


test('market items have a draft_source column for auto-upload draft cleanup', () => {
  assert.ok(migrationName, 'market auto-upload cleanup migration should exist')
  assert.match(migration, /add column if not exists draft_source text not null default 'manual'/)
  assert.match(migration, /market_items_draft_source_check/)
  assert.match(migration, /draft_source in \('manual', 'auto_upload'\)/)
  assert.match(migration, /idx_market_items_auto_upload_draft_cleanup/)
})

test('supabase types and admin item APIs accept draft_source safely', () => {
  assert.match(types, /draft_source: string/)
  assert.match(types, /draft_source\?: string/)
  assert.match(adminItemsRoute, /draftSource: z\.enum\(\['manual', 'auto_upload'\]\)\.optional\(\)/)
  assert.match(adminItemsRoute, /draft_source: parsed\.data\.draftSource/)
  assert.match(adminItemRoute, /draftSource: z\.enum\(\['manual', 'auto_upload'\]\)\.optional\(\)/)
  assert.match(adminItemRoute, /draft_source: parsed\.data\.draftSource/)
})

test('admin upload UI marks only upload-created drafts as auto_upload and explicit saves as manual', () => {
  assert.match(adminProductsClient, /draftSource: 'manual' \| 'auto_upload'/)
  assert.match(adminProductsClient, /draftSource:\s*'auto_upload'/)
  assert.match(adminProductsClient, /draftSource:\s*'manual'/)
  assert.match(adminProductsClient, /requiresFinalRegistration/)
  assert.match(adminProductsClient, /등록 취소 및 파일 삭제/)
})

test('admin product form returns to a blank new-product form (keeping the category) after registration completes', () => {
  assert.match(adminProductsClient, /if \(requiresFinalRegistration\) {\s*resetForm\(getItemCategoryItemId\(result\)\)\s*return\s*}/s)
  assert.match(adminProductsClient, /const createdItem = await persistForm\(undefined, \{ draftSource: 'manual' \}\)[\s\S]+resetForm\(getItemCategoryItemId\(createdItem\)\)/)
  assert.doesNotMatch(adminProductsClient, /menu_entry_id/)
  assert.doesNotMatch(adminProductsClient, /상품 등록 및 파일 업로드/)
})

test('upload draft creation stops before POST until a category is chosen', () => {
  const ensure = adminProductsClient.slice(
    adminProductsClient.indexOf('const ensureDraftItemForUpload = async () => {'),
    adminProductsClient.indexOf('const handleStatusAction = async'),
  )
  assert.match(ensure, /if \(!categoryItemId\) \{\n\s+toast\.error\('카테고리를 먼저 선택해주세요\.'\)\n\s+return null\n\s+\}[\s\S]+await persistForm\('draft'/)
  assert.match(adminProductsClient, /const isUploadBlockedByCategory = !form\.id && !categoryItemId/)
  assert.match(adminProductsClient, /accept="\.pdf,application\/pdf"\n\s+disabled=\{isSampleSourceUploading \|\| isUploadBlockedByCategory\}/)
  assert.match(adminProductsClient, /disabled=\{isSampleSourceUploading \|\| !selectedSampleSourceFile \|\| isUploadBlockedByCategory\}/)
  assert.match(adminProductsClient, /disabled=\{isSubproductSaving \|\| activeSubproductCategories\.length === 0 \|\| isUploadBlockedByCategory\}/)
  assert.equal((adminProductsClient.match(/isUploadBlockedByCategory \? <p className="text-xs text-amber-700">카테고리를 먼저 선택해주세요\.<\/p> : null/g) ?? []).length, 2)
})
