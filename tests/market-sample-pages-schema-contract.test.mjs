import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = readdirSync(migrationsDir).find((name) => name.includes('market_item_sample_pages'))
const migration = migrationName
  ? readFileSync(join(migrationsDir.pathname, migrationName), 'utf8')
  : ''
const helperPath = new URL('../src/lib/market-sample-pages-server.ts', import.meta.url)
const helper = existsSync(helperPath) ? readFileSync(helperPath, 'utf8') : ''
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')

test('market sample page migration stores generated jpg pages separately from market item files', () => {
  assert.ok(migrationName, 'market_item_sample_pages migration should exist')
  assert.match(migration, /create table if not exists public\.market_item_sample_pages/)
  assert.match(migration, /page_number integer not null check \(page_number between 1 and 3\)/)
  assert.match(migration, /source_file_id uuid references public\.market_item_files\(id\)/)
  assert.match(migration, /create unique index if not exists uq_market_item_sample_pages_active_page/)
  assert.match(migration, /alter table public\.market_item_sample_pages enable row level security/)
  assert.match(migration, /Admins can manage market item sample pages/)
  assert.match(migration, /Authenticated users can read active market item sample pages/)
})

test('market sample page server helpers replace and list active generated pages', () => {
  assert.ok(existsSync(helperPath), 'market sample page server helper should exist')
  assert.match(helper, /export async function replaceMarketItemSamplePages/)
  assert.match(helper, /export async function listActiveMarketItemSamplePages/)
  assert.match(helper, /is_active:\s*false/)
  assert.match(helper, /page_number/)
  assert.match(helper, /workspace_subject/)
})

test('supabase generated types include market item sample page rows', () => {
  assert.match(types, /market_item_sample_pages:/)
  assert.match(types, /page_number: number/)
  assert.match(types, /source_file_id: string \| null/)
  assert.match(types, /workspace_subject: string/)
})
