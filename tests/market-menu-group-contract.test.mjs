import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const migrationPath = new URL(
  '../supabase/migrations/20260730010000_create_market_menu_groups.sql',
  import.meta.url
)

const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''

test('market menu groups enforce subject-safe two-level taxonomy in the database', () => {
  assert.ok(existsSync(migrationPath), 'market menu group migration should exist')
  assert.match(migration, /create table if not exists public\.market_menu_groups/i)
  assert.match(migration, /workspace_subject text not null/i)
  assert.match(migration, /workspace_subject in \('english', 'korean'\)/i)
  assert.match(migration, /unique \(workspace_subject, group_key\)/i)
  assert.match(migration, /unique \(id, workspace_subject\)/i)
  assert.match(migration, /add column if not exists group_id uuid/i)
  assert.match(
    migration,
    /foreign key \(group_id, workspace_subject\)[\s\S]*references public\.market_menu_groups \(id, workspace_subject\)/i
  )
  assert.match(migration, /alter table public\.market_menu_groups enable row level security/i)
})

test('group RLS exposes only active public metadata and reserves writes for admins', () => {
  assert.match(
    migration,
    /for select[\s\S]*to anon, authenticated[\s\S]*is_visible = true[\s\S]*is_active = true[\s\S]*deleted_at is null/i
  )
  assert.match(
    migration,
    /for all[\s\S]*to authenticated[\s\S]*using \(public\.is_admin\(\)\)[\s\S]*with check \(public\.is_admin\(\)\)/i
  )
})
