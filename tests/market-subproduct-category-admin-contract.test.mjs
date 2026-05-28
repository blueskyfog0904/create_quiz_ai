import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const lib = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const listRoutePath = new URL('../src/app/api/admin/market/subproduct-categories/route.ts', import.meta.url)
const itemRoutePath = new URL('../src/app/api/admin/market/subproduct-categories/[id]/route.ts', import.meta.url)
const listRoute = existsSync(listRoutePath) ? readFileSync(listRoutePath, 'utf8') : ''
const itemRoute = existsSync(itemRoutePath) ? readFileSync(itemRoutePath, 'utf8') : ''

test('admin subproduct category API exposes authenticated CRUD routes', () => {
  assert.notEqual(listRoute, '')
  assert.notEqual(itemRoute, '')
  assert.match(listRoute, /export async function GET/)
  assert.match(listRoute, /export async function POST/)
  assert.match(itemRoute, /export async function PATCH/)
  assert.match(itemRoute, /export async function DELETE/)
  assert.match(listRoute + itemRoute, /관리자 권한이 필요합니다/)
  assert.match(listRoute + itemRoute, /resolveAdminWorkspaceSubject/)
})

test('category server helpers prevent hard deleting referenced categories', () => {
  assert.match(lib, /export async function listMarketSubproductCategoriesForAdmin/)
  assert.match(lib, /export async function createMarketSubproductCategory/)
  assert.match(lib, /export async function updateMarketSubproductCategory/)
  assert.match(lib, /export async function deleteMarketSubproductCategory/)

  const deleteStart = lib.indexOf('export async function deleteMarketSubproductCategory')
  const deleteSource = lib.slice(deleteStart, lib.indexOf('\nexport ', deleteStart + 1) === -1 ? undefined : lib.indexOf('\nexport ', deleteStart + 1))
  assert.match(deleteSource, /market_item_subproducts/)
  assert.match(deleteSource, /참조|사용 중/)
  assert.doesNotMatch(deleteSource, /\.delete\(\)/)
  assert.match(deleteSource, /deleted_at/)
})
