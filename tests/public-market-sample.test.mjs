import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// 상품의 게시판은 숨김(is_visible=false)으로 둔다. S3부터 샘플 공개는 상품 상태만으로 정해 게시판을 조회하지 않는다.
function harness({ published = true, pages = true } = {}) {
  const signedPaths = []
  const tables = []
  const sourceRequests = []
  const mocks = {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/request-auth': { AUTH_USER_ID_HEADER: 'x-auth-user-id' },
    '@/lib/workspace-subject': { resolveWorkspaceSubject: value => value === 'korean' ? 'korean' : 'english' },
    '@/lib/market-items-server': { getPublishedMarketItemById: async (id, subject) => published && subject === 'korean' ? { id, menu_entry_id: 'hidden-menu' } : null },
    '@/lib/market-sample-pages-server': { listActiveMarketItemSamplePagesWithSourceFileNames: async (id, subject) => {
      sourceRequests.push({ id, subject })
      return pages ? [{ id: 'sample-page', page_number: 1, storage_bucket: 'market-files', storage_path: 'samples/preview.jpg', source_original_file_name: 'sample.pdf', width_px: 500, height_px: 700, file_size_bytes: 100 }] : []
    } },
    '@/lib/supabase/bypass': { createAdminClient: () => ({
      from: (table) => {
        tables.push(table)
        throw new Error(`unexpected table ${table}`)
      },
      storage: { from: () => ({ createSignedUrls: async (paths) => {
        signedPaths.push(...paths)
        return { data: paths.map(path => ({ path, signedUrl: `https://example.test/${path}` })), error: null }
      } }) },
    }) },
  }
  const source = readFileSync(new URL('../src/app/api/market/items/[itemId]/sample-pages/route.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const loaded = { exports: {} }
  new Function('require', 'exports', outputText)((name) => mocks[name], loaded.exports)
  const get = (subject = 'korean') => loaded.exports.GET({ headers: new Headers(), nextUrl: new URL(`http://localhost/api/market/items/item/sample-pages?subject=${subject}`) }, { params: Promise.resolve({ itemId: 'item' }) })
  return { get, signedPaths, tables, sourceRequests }
}

test('anonymous visitors receive only the public sample image URLs', async () => {
  const app = harness()
  const response = await app.get()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.pages.length, 1)
  assert.deepEqual(app.signedPaths, ['samples/preview.jpg'])
  assert.equal('storage_path' in body.pages[0], false)
  assert.deepEqual(app.sourceRequests, [{ id: 'item', subject: 'korean' }])
})

test('a published item on a hidden board still serves samples without reading the board', async () => {
  const app = harness()
  assert.equal((await app.get()).status, 200)
  assert.deepEqual(app.tables, [])
})

for (const [name, options, subject] of [
  ['unpublished or missing item', { published: false }, 'korean'],
  ['wrong subject', {}, 'english'],
]) test(`${name} cannot issue sample URLs`, async () => {
  const app = harness(options)
  assert.equal((await app.get(subject)).status, 404)
  assert.deepEqual(app.signedPaths, [])
  assert.deepEqual(app.sourceRequests, [])
})

test('an item without samples returns an empty list, not paid files', async () => {
  const app = harness({ pages: false })
  const response = await app.get()
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).pages, [])
  assert.deepEqual(app.signedPaths, [])
})
