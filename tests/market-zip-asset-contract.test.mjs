import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const initialMigration = readFileSync(new URL('../supabase/migrations/20260317113000_create_market_items_purchase_domain.sql', import.meta.url), 'utf8')
const generatedTypes = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')
const migrationsAndTypes = `${initialMigration}\n${generatedTypes}`
const adminClient = readFileSync(new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url), 'utf8')
const adminCreateRoute = readFileSync(new URL('../src/app/api/admin/market/items/route.ts', import.meta.url), 'utf8')
const adminUpdateRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/route.ts', import.meta.url), 'utf8')
const storage = readFileSync(new URL('../src/lib/market-storage.ts', import.meta.url), 'utf8')
const filesRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/files/route.ts', import.meta.url), 'utf8')

test('market schema and generated types include zip price and zip asset constraints', () => {
  assert.match(migrationsAndTypes, /zip_price/)
  assert.match(migrationsAndTypes, /asset_kind[\s\S]+zip/)
})

test('admin product form persists zip price and exposes a zip upload slot', () => {
  assert.match(adminClient, /zipPrice/)
  assert.match(adminClient, /MarketFileType/)
  assert.match(adminClient, /fileTypes/)
  assert.match(adminClient, /getFileTypeAcceptValue/)
  assert.match(adminClient, /파일추가/)
  assert.match(adminCreateRoute, /zipPrice/)
  assert.match(adminCreateRoute, /zip_price/)
  assert.match(adminUpdateRoute, /zipPrice/)
  assert.match(adminUpdateRoute, /zip_price/)
})

test('market storage and admin file route allow zip as a paid asset without sample generation', () => {
  assert.match(storage, /MARKET_ALLOWED_EXTENSIONS = \['pdf', 'hwp', 'zip'\] as const/)
  assert.match(storage, /assetKind:\s*'pdf' \| 'hwp' \| 'zip'/)
  assert.match(storage, /ZIP 자산에는 ZIP 파일만 업로드할 수 있습니다\.|zip[\s\S]+extension !== 'zip'/)
  assert.match(filesRoute, /assetKindValue !== 'pdf' && assetKindValue !== 'hwp' && assetKindValue !== 'zip'/)
  assert.doesNotMatch(filesRoute, /generateMarketPdfSamplePages/)
  assert.doesNotMatch(filesRoute, /replaceMarketItemSamplePages/)
  assert.doesNotMatch(filesRoute, /sampleGenerationStatus/)
})
