import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const migrationPath = new URL(
  '../supabase/migrations/20260730010000_create_market_menu_groups.sql',
  import.meta.url
)
const serverPath = new URL('../src/lib/market-menu-groups-server.ts', import.meta.url)
const actionsPath = new URL(
  '../src/app/(admin)/admin/menu-management/actions.ts',
  import.meta.url
)

const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
const server = existsSync(serverPath) ? readFileSync(serverPath, 'utf8') : ''
const actions = readFileSync(actionsPath, 'utf8')

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

test('group server helpers validate and scope every write to one subject', () => {
  assert.ok(existsSync(serverPath), 'market menu group server helper should exist')
  assert.match(server, /export async function listMarketMenuGroupsForAdmin/)
  assert.match(server, /export async function listVisibleMarketMenuGroups/)
  assert.match(server, /export async function createMarketMenuGroup/)
  assert.match(server, /export async function updateMarketMenuGroup/)
  assert.match(server, /export async function archiveMarketMenuGroup/)
  assert.match(server, /export async function reorderMarketMenuGroups/)
  assert.match(server, /export async function assignMarketMenuEntriesToGroup/)
  assert.match(server, /\.eq\('workspace_subject', workspaceSubject\)/)
  assert.match(server, /new Set\(ids\)\.size !== ids\.length/)
  assert.match(server, /group_id:\s*groupId/)
})

test('visible navigation keeps unassigned or unavailable-group entries in an honest fallback', () => {
  assert.match(server, /UNGROUPED_MARKET_MENU_GROUP_ID/)
  assert.match(server, /UNGROUPED_MARKET_MENU_GROUP_TITLE/)
  assert.match(server, /visibleGroupIds\.has\(entry\.group_id/)
  assert.match(server, /isFallback:\s*true/)
})

test('menu management actions keep the admin boundary and revalidate both subject previews', () => {
  assert.match(actions, /createMarketMenuGroupAction[\s\S]*await requireAdmin\(\)/)
  assert.match(actions, /updateMarketMenuGroupAction[\s\S]*await requireAdmin\(\)/)
  assert.match(actions, /archiveMarketMenuGroupAction[\s\S]*await requireAdmin\(\)/)
  assert.match(actions, /reorderMarketMenuGroupsAction[\s\S]*await requireAdmin\(\)/)
  assert.match(actions, /assignMarketMenuEntriesToGroupAction[\s\S]*await requireAdmin\(\)/)
  assert.match(actions, /assertWorkspaceSubject\(workspaceSubject\)/)
  assert.match(actions, /marketMenuEntryGroupAssignments/)
  assert.match(actions, /groupId:\s*entry\.group_id \?\? null/)
  assert.match(actions, /revalidatePath\('\/preview\/solvook-concept'/)
  assert.match(
    actions,
    /revalidatePath\('\/preview\/solvook-concept\/boards\/\[slug\]', 'page'\)/
  )
})
