import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = readdirSync(migrationsDir).find((name) => name.includes('market_subproduct_v2_schema'))
const migration = migrationName
  ? readFileSync(join(migrationsDir.pathname, migrationName), 'utf8')
  : ''
const allMigrations = readdirSync(migrationsDir)
  .filter((name) => (
    name.includes('market_subproduct_v2')
    || name.includes('market_subproduct_category_defaults')
    || name.includes('market_subproduct_purchase_notice')
  ))
  .map((name) => readFileSync(join(migrationsDir.pathname, name), 'utf8'))
  .join('\n')
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')

test('market v2 schema migration creates subproduct catalog and purchase entitlement tables', () => {
  assert.ok(migrationName, 'market_subproduct_v2_schema migration should exist')
  for (const table of [
    'market_subproduct_categories',
    'market_file_types',
    'market_item_subproducts',
    'market_subproduct_files',
    'market_item_bundle_options',
    'market_purchase_orders',
    'market_purchase_lines',
    'market_entitlements',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `${table} should be created`)
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} should enable RLS`)
  }

  assert.doesNotMatch(migration, /market_file_type_entitlement_rules/)
})

test('market v2 schema migration gives composite FK targets unique workspace keys', () => {
  for (const indexName of [
    'uq_market_items_id_workspace_subject',
    'uq_market_subproduct_categories_id_workspace_subject',
    'uq_market_file_types_id_workspace_subject',
    'uq_market_item_subproducts_id_workspace_subject',
    'uq_market_subproduct_files_id_workspace_subject',
    'uq_market_item_bundle_options_id_workspace_subject',
    'uq_market_purchase_orders_id_workspace_subject',
  ]) {
    assert.match(migration, new RegExp(`create unique index if not exists ${indexName}`), `${indexName} should exist`)
  }

  assert.match(migration, /market_entitlements_file_workspace_fkey[\s\S]+references public\.market_subproduct_files\(id, workspace_subject\)/)
})

test('market v2 migrations cover new foreign keys with indexes and fixed function search path', () => {
  assert.match(allMigrations, /set_market_subproduct_updated_at\(\)[\s\S]+set search_path = public/)

  for (const indexSql of [
    /on public\.market_item_subproducts\(item_id, workspace_subject\)/,
    /on public\.market_item_subproducts\(category_id, workspace_subject\)/,
    /on public\.market_subproduct_files\(item_id, workspace_subject\)/,
    /on public\.market_subproduct_files\(subproduct_id, workspace_subject\)/,
    /on public\.market_subproduct_files\(file_type_id, workspace_subject\)/,
    /on public\.market_item_bundle_options\(item_id, workspace_subject\)/,
    /on public\.market_purchase_orders\(item_id, workspace_subject\)/,
    /on public\.market_purchase_lines\(order_id, workspace_subject\)/,
    /on public\.market_purchase_lines\(subproduct_id, workspace_subject\)/,
    /on public\.market_purchase_lines\(bundle_option_id, workspace_subject\)/,
    /on public\.market_entitlements\(item_id, workspace_subject\)/,
    /on public\.market_entitlements\(subproduct_id, workspace_subject\)/,
    /on public\.market_entitlements\(file_id, workspace_subject\)/,
    /on public\.market_entitlements\(source_order_id, workspace_subject\)/,
  ]) {
    assert.match(allMigrations, indexSql, `${indexSql} should be indexed`)
  }
})

test('market v2 schema migration seeds default file types without implicit file-type coverage rules', () => {
  assert.match(migration, /insert into public\.market_file_types/)
  assert.match(migration, /'pdf'/)
  assert.match(migration, /'hwp'/)
  assert.match(migration, /'zip'/)
  assert.doesNotMatch(migration, /HWP covers PDF/i)
  assert.doesNotMatch(migration, /same_subproduct/)
})

test('market v2 category defaults use workbook and explicit PDF/HWP question categories', () => {
  assert.match(allMigrations, /insert into public\.market_subproduct_categories/)
  assert.match(allMigrations, /'워크북'/)
  assert.match(allMigrations, /'문제\(PDF\)'/)
  assert.match(allMigrations, /'문제\(HWP\)'/)
  assert.match(allMigrations, /'workbook'/)
  assert.match(allMigrations, /'question_pdf'/)
  assert.match(allMigrations, /'question_hwp'/)
  assert.match(allMigrations, /legacy_pdf/)
  assert.match(allMigrations, /legacy_hwp_bundle/)
  assert.match(allMigrations, /legacy_zip/)
  assert.match(allMigrations, /set is_active = false/)
})

test('market v2 schema migration keeps bundle purchases full-price and records charged credits only', () => {
  assert.match(migration, /create table if not exists public\.market_item_bundle_options/)
  assert.match(migration, /charged_credits integer not null default 0/)
  assert.doesNotMatch(migration, /discount_credits/)
  assert.doesNotMatch(migration, /owned_active_subproduct_price_sum/)
})

test('market v2 schema migration relaxes sample page constraints for arbitrary draft pages', () => {
  assert.match(migration, /alter table public\.market_item_sample_pages[\s\S]+page_number > 0/)
  assert.match(migration, /add column if not exists display_order integer not null default 0/)
  assert.match(migration, /add column if not exists source_batch_id uuid/)
  assert.match(migration, /add column if not exists draft_token text/)
  assert.match(migration, /add column if not exists status text not null default 'active'/)
  assert.match(migration, /drop index if exists public\.uq_market_item_sample_pages_active_page/)
})

test('supabase generated types include market v2 tables and sample draft columns', () => {
  for (const table of [
    'market_subproduct_categories',
    'market_file_types',
    'market_item_subproducts',
    'market_subproduct_files',
    'market_item_bundle_options',
    'market_purchase_orders',
    'market_purchase_lines',
    'market_entitlements',
  ]) {
    assert.match(types, new RegExp(`${table}:`), `${table} should be present in generated types`)
  }

  assert.match(types, /display_order: number/)
  assert.match(types, /source_batch_id: string \| null/)
  assert.match(types, /draft_token: string \| null/)
  assert.match(types, /status: string/)
  assert.match(types, /committed_at: string \| null/)
})

test('market item subproducts store editable purchase notice copy', () => {
  assert.match(allMigrations, /alter table public\.market_item_subproducts[\s\S]+purchase_notice_label text/)
  assert.match(allMigrations, /alter table public\.market_item_subproducts[\s\S]+purchase_notice_text text/)
  assert.match(allMigrations, /comment on column public\.market_item_subproducts\.purchase_notice_label/)
  assert.match(allMigrations, /comment on column public\.market_item_subproducts\.purchase_notice_text/)

  assert.match(types, /purchase_notice_label: string \| null/)
  assert.match(types, /purchase_notice_text: string \| null/)
  assert.match(types, /purchase_notice_label\?: string \| null/)
  assert.match(types, /purchase_notice_text\?: string \| null/)
})
