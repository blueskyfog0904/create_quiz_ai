import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const lib = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const listRoutePath = new URL('../src/app/api/admin/market/file-types/route.ts', import.meta.url)
const itemRoutePath = new URL('../src/app/api/admin/market/file-types/[id]/route.ts', import.meta.url)
const listRoute = existsSync(listRoutePath) ? readFileSync(listRoutePath, 'utf8') : ''
const itemRoute = existsSync(itemRoutePath) ? readFileSync(itemRoutePath, 'utf8') : ''

test('admin file type API exposes authenticated CRUD routes', () => {
  assert.notEqual(listRoute, '')
  assert.notEqual(itemRoute, '')
  assert.match(listRoute, /export async function GET/)
  assert.match(listRoute, /export async function POST/)
  assert.match(itemRoute, /export async function PATCH/)
  assert.match(itemRoute, /export async function DELETE/)
  assert.match(listRoute + itemRoute, /관리자 권한이 필요합니다/)
  assert.match(listRoute + itemRoute, /resolveAdminWorkspaceSubject/)
})

test('file type server helpers lock referenced file type identity fields', () => {
  assert.match(lib, /export async function listMarketFileTypesForAdmin/)
  assert.match(lib, /export async function createMarketFileType/)
  assert.match(lib, /export async function updateMarketFileType/)
  assert.match(lib, /export async function deleteMarketFileType/)

  const updateStart = lib.indexOf('export async function updateMarketFileType')
  const updateSource = lib.slice(updateStart, lib.indexOf('\nexport ', updateStart + 1) === -1 ? undefined : lib.indexOf('\nexport ', updateStart + 1))
  assert.match(updateSource, /market_subproduct_files/)
  assert.match(updateSource, /code|extension|mime_allowlist/)
  assert.match(updateSource, /사용 중/)

  const deleteStart = lib.indexOf('export async function deleteMarketFileType')
  const deleteSource = lib.slice(deleteStart, lib.indexOf('\nexport ', deleteStart + 1) === -1 ? undefined : lib.indexOf('\nexport ', deleteStart + 1))
  assert.match(deleteSource, /market_subproduct_files/)
  assert.doesNotMatch(deleteSource, /\.delete\(\)/)
  assert.match(deleteSource, /deleted_at/)
})
