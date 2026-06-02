import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const allMigrations = readdirSync(migrationsDir)
  .map((name) => readFileSync(join(migrationsDir.pathname, name), 'utf8'))
  .join('\n')
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')

test('market refund migration creates dedicated refund requests with RLS and target constraints', () => {
  assert.match(allMigrations, /create table if not exists public\.market_refund_requests/)
  assert.match(allMigrations, /target_kind text not null[\s\S]+legacy_purchase[\s\S]+v2_order/)
  assert.match(allMigrations, /requested_refund_credits integer not null/)
  assert.match(allMigrations, /eligibility_snapshot jsonb not null default '\{\}'::jsonb/)
  assert.match(allMigrations, /market_refund_requests_target_check/)
  assert.match(allMigrations, /alter table public\.market_refund_requests enable row level security/)
  assert.match(allMigrations, /Users can read own market refund requests/)
  assert.match(allMigrations, /Admins can manage market refund requests/)
  assert.match(allMigrations, /drop policy if exists "Users can insert own market refund requests"/)
})

test('market refund migration prevents duplicate pending or approved requests per target', () => {
  assert.match(allMigrations, /uq_market_refund_requests_pending_order/)
  assert.match(allMigrations, /where target_kind = 'v2_order' and status in \('pending', 'approved'\)/)
  assert.match(allMigrations, /uq_market_refund_requests_pending_legacy/)
  assert.match(allMigrations, /where target_kind = 'legacy_purchase' and status in \('pending', 'approved'\)/)
})

test('market download events can record v2 subproduct file downloads for refund eligibility', () => {
  assert.match(allMigrations, /alter table public\.market_download_events[\s\S]+add column if not exists event_target_type/)
  assert.match(allMigrations, /add column if not exists order_id uuid references public\.market_purchase_orders\(id\)/)
  assert.match(allMigrations, /add column if not exists entitlement_id uuid references public\.market_entitlements\(id\)/)
  assert.match(allMigrations, /add column if not exists subproduct_file_id uuid references public\.market_subproduct_files\(id\)/)
  assert.match(allMigrations, /update public\.market_download_events[\s\S]+set event_target_type = 'legacy_asset'/)
})

test('market purchases and orders store credit consumption snapshots for later refunds', () => {
  assert.match(allMigrations, /alter table public\.market_purchases[\s\S]+add column if not exists credit_consumptions jsonb/)
  assert.match(allMigrations, /alter table public\.market_purchase_orders[\s\S]+add column if not exists credit_consumptions jsonb/)
  assert.match(types, /market_refund_requests:/)
  assert.match(types, /credit_consumptions: Json \| null/)
  assert.match(types, /subproduct_file_id: string \| null/)
})
