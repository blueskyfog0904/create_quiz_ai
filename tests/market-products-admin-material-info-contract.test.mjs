import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = readdirSync(migrationsDir).find((name) => name.includes('market_item_question_count'))
const migration = migrationName ? readFileSync(join(migrationsDir.pathname, migrationName), 'utf8') : ''
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')
const marketItemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const adminItemsRoute = readFileSync(new URL('../src/app/api/admin/market/items/route.ts', import.meta.url), 'utf8')
const adminItemRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/route.ts', import.meta.url), 'utf8')
const adminProductsClient = readFileSync(new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url), 'utf8')
const itemPage = readFileSync(new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx', import.meta.url), 'utf8')

test('market items persist an explicit question count for material information', () => {
  assert.ok(migrationName, 'market item question_count migration should exist')
  assert.match(migration, /add column if not exists question_count integer/)
  assert.match(migration, /market_items_question_count_check/)
  assert.match(migration, /question_count is null or question_count >= 0/)
  assert.match(migration, /comment on column public\.market_items\.question_count/)
  assert.match(types, /question_count: number \| null/)
  assert.match(types, /question_count\?: number \| null/)
})

test('admin market item APIs map material information fields', () => {
  assert.match(adminItemsRoute, /questionCount: z\.number\(\)\.int\(\)\.min\(0\)\.nullable\(\)\.optional\(\)/)
  assert.match(adminItemsRoute, /question_count: parsed\.data\.questionCount \?\? null/)
  assert.match(adminItemRoute, /questionCount: z\.number\(\)\.int\(\)\.min\(0\)\.nullable\(\)\.optional\(\)/)
  assert.match(adminItemRoute, /question_count: parsed\.data\.questionCount/)
  assert.doesNotMatch(adminItemRoute, /question_count: parsed\.data\.questionCount \?\? null/)
  assert.match(marketItemsServer, /'question_count'/)
  assert.match(marketItemsServer, /question_count: input\.question_count \?\? null/)
  assert.match(marketItemsServer, /question_count: input\.question_count === undefined \? current\.question_count : input\.question_count/)
})

test('admin product form exposes material information inputs', () => {
  assert.match(adminProductsClient, /sourceType: string/)
  assert.match(adminProductsClient, /source1: string/)
  assert.match(adminProductsClient, /source2: string/)
  assert.match(adminProductsClient, /source3: string/)
  assert.match(adminProductsClient, /source4: string/)
  assert.match(adminProductsClient, /questionCount: string/)
  assert.match(adminProductsClient, /자료 정보/)
  assert.match(adminProductsClient, /상세 페이지 자료 정보 카드에 노출되는 값을 입력합니다/)
  assert.match(adminProductsClient, /Label>과목<\/Label/)
  assert.match(adminProductsClient, /Label>자료유형<\/Label/)
  assert.match(adminProductsClient, /Label>출처 1<\/Label/)
  assert.match(adminProductsClient, /Label>출처 2<\/Label/)
  assert.match(adminProductsClient, /Label>출처 3<\/Label/)
  assert.match(adminProductsClient, /Label>출처 4<\/Label/)
  assert.match(adminProductsClient, /Label>문항 수<\/Label/)
  assert.match(adminProductsClient, /Label>등록일자<\/Label/)
  assert.match(adminProductsClient, /sourceType: form\.sourceType/)
  assert.match(adminProductsClient, /source1: form\.source1/)
  assert.match(adminProductsClient, /source4: form\.source4/)
  assert.match(adminProductsClient, /questionCount: form\.questionCount \? Number\(form\.questionCount\) : null/)
})

test('public detail page prefers explicit question_count for material information', () => {
  assert.match(itemPage, /item\.question_count !== null && item\.question_count !== undefined/)
  assert.match(itemPage, /`\$\{item\.question_count\}문항`/)
})
