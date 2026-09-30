import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function harness({ published = true, visibleMenu = true, pages = true } = {}) {
  const signedPaths = []
  const menuFilters = []
  const sourceRequests = []
  const mocks = {
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    '@/lib/request-auth': { AUTH_USER_ID_HEADER: 'x-auth-user-id' },
    '@/lib/workspace-subject': { resolveWorkspaceSubject: value => value === 'korean' ? 'korean' : 'english' },
    '@/lib/market-items-server': { getPublishedMarketItemById: async (id, subject) => published && subject === 'korean' ? { id, menu_entry_id: 'visible-menu' } : null },
    '@/lib/market-sample-pages-server': { listActiveMarketItemSamplePagesWithSourceFileNames: async (id, subject) => {
      sourceRequests.push({ id, subject })
      return pages ? [{ id: 'sample-page', page_number: 1, storage_bucket: 'market-files', storage_path: 'samples/preview.jpg', source_original_file_name: 'sample.pdf', width_px: 500, height_px: 700, file_size_bytes: 100 }] : []
    } },
    '@/lib/supabase/bypass': { createAdminClient: () => ({
      from: (table) => {
        assert.equal(table, 'market_menu_entries')
        const query = {
          select: () => query,
          eq: (field, value) => { menuFilters.push([field, value]); return query },
          is: (field, value) => { menuFilters.push([field, value]); return query },
          maybeSingle: async () => ({ data: visibleMenu ? { id: 'visible-menu' } : null, error: null }),
        }
        return query
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
  return { get, signedPaths, menuFilters, sourceRequests }
}

test('anonymous visitors receive only the public sample image URLs', async () => {
  const app = harness()
  const response = await app.get()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.pages.length, 1)
  assert.deepEqual(app.signedPaths, ['samples/preview.jpg'])
  assert.equal('storage_path' in body.pages[0], false)
  assert.ok(app.menuFilters.some(([key, value]) => key === 'is_visible' && value === true))
  assert.ok(app.menuFilters.some(([key, value]) => key === 'is_active' && value === true))
  assert.ok(app.menuFilters.some(([key, value]) => key === 'workspace_subject' && value === 'korean'))
  assert.ok(app.menuFilters.some(([key, value]) => key === 'deleted_at' && value === null))
})

for (const [name, options, subject] of [
  ['unpublished or missing item', { published: false }, 'korean'],
  ['hidden menu', { visibleMenu: false }, 'korean'],
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
