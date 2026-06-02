import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const allMigrations = readdirSync(migrationsDir)
  .map((name) => readFileSync(join(migrationsDir.pathname, name), 'utf8'))
  .join('\n')
const types = readFileSync(new URL('../src/types/supabase.ts', import.meta.url), 'utf8')

test('support category migration creates managed categories with soft-delete only RLS', () => {
  assert.match(allMigrations, /create table if not exists public\.support_ticket_categories/)
  assert.match(allMigrations, /slug text not null/)
  assert.match(allMigrations, /guide_items jsonb not null default '\[\]'::jsonb/)
  assert.match(allMigrations, /subject_placeholder text/)
  assert.match(allMigrations, /message_placeholder text/)
  assert.match(allMigrations, /deleted_at timestamp with time zone/)
  assert.match(allMigrations, /alter table public\.support_ticket_categories enable row level security/)
  assert.match(allMigrations, /Users can read active support ticket categories/)
  assert.match(allMigrations, /Admins can insert support ticket categories/)
  assert.match(allMigrations, /Admins can update support ticket categories/)
  assert.doesNotMatch(allMigrations, /create policy "Admins can delete support ticket categories"/)
})

test('support ticket migration stores category snapshot and replaces broad user writes with hardened RPCs', () => {
  assert.match(allMigrations, /alter table public\.support_tickets[\s\S]+add column if not exists category_id uuid/)
  assert.match(allMigrations, /add column if not exists category_snapshot jsonb/)
  assert.match(allMigrations, /drop policy if exists "Users can insert own tickets" on public\.support_tickets/)
  assert.match(allMigrations, /drop policy if exists "Users can update own tickets" on public\.support_tickets/)
  assert.match(allMigrations, /create or replace function public\.create_support_ticket/)
  assert.match(allMigrations, /create or replace function public\.update_own_pending_support_ticket/)
  assert.match(allMigrations, /create or replace function public\.soft_delete_own_support_ticket/)
  assert.match(allMigrations, /security definer/)
  assert.match(allMigrations, /set search_path = public, pg_temp/)
  assert.match(allMigrations, /revoke all on function public\.create_support_ticket/)
  assert.match(allMigrations, /grant execute on function public\.create_support_ticket/)
  assert.match(allMigrations, /revoke all on function public\.create_support_ticket\(uuid, text, text\) from anon/)
  assert.match(allMigrations, /revoke all on function public\.update_own_pending_support_ticket\(uuid, uuid, text, text\) from anon/)
  assert.match(allMigrations, /revoke all on function public\.soft_delete_own_support_ticket\(uuid\) from anon/)
})

test('supabase types include support categories and ticket category fields', () => {
  assert.match(types, /support_ticket_categories:/)
  assert.match(types, /guide_items: Json/)
  assert.match(types, /category_id: string \| null/)
  assert.match(types, /category_snapshot: Json \| null/)
})
