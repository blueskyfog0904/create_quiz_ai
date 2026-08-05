import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260728010000_add_market_home_download_ranking.sql', import.meta.url),
  'utf8'
)

test('ranking counts distinct URL-issuance users from the requested boundary', () => {
  assert.match(migration, /count\s*\(\s*distinct\s+events\.user_id\s*\)/i)
  assert.match(migration, /events\.created_at\s*>=\s*p_from/i)
  assert.match(migration, /p_from\s+timestamptz/i)
})

test('ranking only includes public subject-scoped items in visible menus', () => {
  assert.match(migration, /items\.workspace_subject\s*=\s*p_workspace_subject/i)
  assert.match(migration, /items\.status\s*=\s*'published'/i)
  assert.match(migration, /items\.is_active\s*=\s*true/i)
  assert.match(migration, /items\.deleted_at\s+is\s+null/i)
  assert.match(migration, /menus\.is_visible\s*=\s*true/i)
  assert.match(migration, /menus\.is_active\s*=\s*true/i)
  assert.match(migration, /menus\.deleted_at\s+is\s+null/i)
})

test('ranking order and execute privileges are deterministic and service-role only', () => {
  assert.match(migration, /download_issuer_user_count\s+desc[\s\S]*items\.published_at\s+desc\s+nulls\s+last[\s\S]*items\.id\s+asc/i)
  assert.match(migration, /auth\.role\(\)\s*<>\s*'service_role'/i)
  assert.match(migration, /revoke\s+all[\s\S]*from\s+public/i)
  assert.match(migration, /revoke\s+all[\s\S]*from\s+anon/i)
  assert.match(migration, /revoke\s+all[\s\S]*from\s+authenticated/i)
  assert.match(migration, /grant\s+execute[\s\S]*to\s+service_role/i)
})

test('ranking adds the planned covering event index', () => {
  assert.match(
    migration,
    /on\s+public\.market_download_events\s*\(\s*workspace_subject\s*,\s*created_at\s+desc\s*,\s*item_id\s*,\s*user_id\s*\)/i
  )
})
