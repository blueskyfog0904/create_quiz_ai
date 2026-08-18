import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260807090000_create_market_item_reviews.sql',
  import.meta.url
)
const hardeningMigrationUrl = new URL(
  '../supabase/migrations/20260807091000_harden_market_item_reviews_rls.sql',
  import.meta.url
)
const anonPolicyMigrationUrl = new URL(
  '../supabase/migrations/20260807092000_fix_market_item_reviews_anon_select.sql',
  import.meta.url
)

test('market item reviews enforce purchaser-only ratings with RLS', async () => {
  const source = await readFile(migrationUrl, 'utf8')

  assert.match(source, /create table if not exists public\.market_item_reviews/)
  assert.match(source, /rating smallint not null check \(rating between 1 and 5\)/)
  assert.match(source, /foreign key \(item_id, workspace_subject\)/)
  assert.match(source, /references public\.market_items\(id, workspace_subject\)/)
  assert.match(source, /create unique index if not exists uq_market_item_reviews_active_user_item/)
  assert.match(source, /where deleted_at is null/)
  assert.match(source, /alter table public\.market_item_reviews enable row level security/)
  assert.match(source, /to anon, authenticated/)
  assert.match(source, /from public\.market_entitlements entitlements/)
  assert.match(source, /entitlements\.user_id = auth\.uid\(\)/)
  assert.match(source, /entitlements\.status = 'active'/)
  assert.match(source, /user_id = auth\.uid\(\)/)
  assert.match(source, /public\.is_admin\(\)/)
  assert.match(source, /grant select on public\.market_item_reviews to anon, authenticated/)
  assert.match(source, /grant insert, update, delete on public\.market_item_reviews to authenticated/)
})

test('market item review policies avoid duplicate admin policies and per-row auth evaluation', async () => {
  const source = await readFile(hardeningMigrationUrl, 'utf8')

  assert.match(source, /on public\.market_item_reviews\(item_id, workspace_subject\)/)
  assert.match(source, /\(select auth\.uid\(\)\)/)
  assert.match(source, /\(select public\.is_admin\(\)\)/)
  assert.match(source, /drop policy if exists "Admins can manage market item reviews"/)
  assert.doesNotMatch(source, /create policy "Admins can manage market item reviews"/)
})

test('anonymous review reads do not call authenticated-only admin helpers', async () => {
  const source = await readFile(anonPolicyMigrationUrl, 'utf8')

  assert.match(source, /to anon, authenticated/)
  assert.match(source, /items\.status = 'published'/)
  assert.match(source, /items\.is_active = true/)
  assert.doesNotMatch(source, /is_admin/)
})
