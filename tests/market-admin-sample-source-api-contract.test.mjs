import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const sourcePath = new URL('../src/app/api/admin/market/items/[id]/sample-pages/source/route.ts', import.meta.url)
const deletePath = new URL('../src/app/api/admin/market/items/[id]/sample-pages/[pageId]/route.ts', import.meta.url)
const sourceRoute = existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : ''
const deleteRoute = existsSync(deletePath) ? readFileSync(deletePath, 'utf8') : ''

test('admin sample source upload is admin and workspace gated', () => {
  assert.ok(existsSync(sourcePath), 'source upload route should exist')
  assert.match(sourceRoute, /UNAUTHORIZED/)
  assert.match(sourceRoute, /FORBIDDEN/)
  assert.match(sourceRoute, /resolveAdminWorkspaceSubject/)
  assert.match(sourceRoute, /getMarketItemById/)
  assert.match(sourceRoute, /workspace_subject|workspaceSubject/)
  assert.match(sourceRoute, /application\/pdf|\.pdf|PDF/)
})

test('admin sample page delete verifies item ownership before deleting storage', () => {
  assert.ok(existsSync(deletePath), 'sample page delete route should exist')
  assert.match(deleteRoute, /UNAUTHORIZED/)
  assert.match(deleteRoute, /FORBIDDEN/)
  assert.match(deleteRoute, /pageId/)
  assert.match(deleteRoute, /item_id|itemId/)
  assert.match(deleteRoute, /workspace_subject|workspaceSubject/)
  assert.match(deleteRoute, /deactivateMarketItemSamplePage|deleteMarketItemSamplePage/)
  assert.match(deleteRoute, /remove\(/)
})
