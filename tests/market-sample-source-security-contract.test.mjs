import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const downloadRoute = readFileSync(new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url), 'utf8')
const sampleSourceRoutePath = new URL('../src/app/api/admin/market/items/[id]/sample-pages/source/route.ts', import.meta.url)
const sampleSourceRoute = existsSync(sampleSourceRoutePath) ? readFileSync(sampleSourceRoutePath, 'utf8') : ''
const sampleApiRoute = readFileSync(new URL('../src/app/api/admin/market/items/[id]/sample-pages/route.ts', import.meta.url), 'utf8')

test('legacy sample files do not drive user-facing sample availability', () => {
  assert.doesNotMatch(itemsServer, /samplePages\.length > 0 \|\| filesForItem\.sample !== null/)
  assert.match(itemsServer, /sample:\s*\{\s*available:\s*samplePages\.length > 0/)
})

test('public download route no longer serves legacy sample files', () => {
  assert.doesNotMatch(downloadRoute, /assetKind !== 'sample'/)
  assert.match(downloadRoute, /assetKind는 pdf\/hwp\/zip 중 하나여야 합니다|pdf\/hwp\/zip/)
})

test('admin sample source upload does not store source pdf as an active market item file', () => {
  assert.ok(existsSync(sampleSourceRoutePath), 'sample source upload route should exist')
  assert.match(sampleSourceRoute, /requireAdminUser/)
  assert.match(sampleSourceRoute, /resolveAdminWorkspaceSubject/)
  assert.match(sampleSourceRoute, /MAX_SAMPLE_SOURCE_PDF_SIZE/)
  assert.match(sampleSourceRoute, /source_file_id:\s*null|sourceFileId:\s*null/)
  assert.doesNotMatch(sampleSourceRoute, /replaceMarketItemFile/)
  assert.match(sampleApiRoute, /id:/)
})
