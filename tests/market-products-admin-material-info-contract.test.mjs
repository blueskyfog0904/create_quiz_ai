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
const materialDetail = readFileSync(new URL('../src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx', import.meta.url), 'utf8')

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
  // 출처 1~4는 쓰지 않아 폼에서 뺐다(DB 칼럼은 그대로, 수정 저장 시 기존 값 유지).
  assert.doesNotMatch(adminProductsClient, /source[1-4]: (string|form\.)/)
  assert.match(adminProductsClient, /questionCount: string/)
  assert.match(adminProductsClient, /자료 정보/)
  assert.match(adminProductsClient, /상세 페이지 자료 정보 카드에 노출되는 값을 입력합니다/)
  // 과목·등록일자는 자동 값이라 입력칸을 두지 않는다.
  assert.doesNotMatch(adminProductsClient, /Label>과목<\/Label/)
  assert.match(adminProductsClient, /Label>자료유형<\/Label/)
  assert.doesNotMatch(adminProductsClient, /Label>출처/)
  assert.match(adminProductsClient, /Label>문항 수<\/Label/)
  assert.doesNotMatch(adminProductsClient, /Label>등록일자<\/Label/)
  assert.match(adminProductsClient, /sourceType: form\.sourceType/)
  assert.match(adminProductsClient, /questionCount: form\.questionCount \? Number\(form\.questionCount\) : null/)
})

// 예전 상세 page는 S4-2b에서 지웠다. 지금 상세(market-material-detail)는 계산값 대신 question_count만 보인다.
test('public detail page shows explicit question_count for material information', () => {
  assert.match(materialDetail, /value: item\.question_count === null/)
  assert.match(materialDetail, /item\.question_count\.toLocaleString\('ko-KR'\)/)
})
