import assert from 'node:assert/strict'
import test from 'node:test'
import { load, createFakeAdmin, marketImages, loadRoute } from './helpers/market-images-harness.mjs'

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const FILE_ID = '22222222-2222-4222-8222-222222222222'
const SUBPRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const ORDER_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '00000000-0000-4000-8000-000000000001'

// 실제 다운로드 route + 실제 market-items-server(상태 판정)·market-purchase(권한 판정)를 가짜 DB로 돌린다.
function loadDownloadRoute({ item, entitled, fileActive = true }) {
  const events = []
  const { client } = createFakeAdmin(({ table, ops }) => {
    const isInsert = ops.some(([name]) => name === 'insert')
    if (table === 'market_items') return { data: item, error: null }
    if (table === 'market_subproduct_files') {
      return {
        data: fileActive
          ? { id: FILE_ID, item_id: ITEM_ID, subproduct_id: SUBPRODUCT_ID, file_type_id: 'ft', workspace_subject: 'korean', storage_bucket: 'market-files', storage_path: 'a/b.pdf', original_file_name: 'b.pdf', is_active: true, deleted_at: null }
          : null,
        error: null,
      }
    }
    if (table === 'market_item_subproducts') return { data: { id: SUBPRODUCT_ID, title: '서브상품', is_active: true, deleted_at: null }, error: null }
    if (table === 'market_file_types') return { data: { id: 'ft', code: 'pdf', label: 'PDF' }, error: null }
    if (table === 'market_entitlements') {
      return {
        data: entitled
          ? [{ id: 'ent-1', workspace_subject: 'korean', user_id: USER_ID, item_id: ITEM_ID, scope: 'subproduct', subproduct_id: SUBPRODUCT_ID, file_id: null, legacy_asset_kind: null, source_order_id: ORDER_ID, source_purchase_id: null, status: 'active' }]
          : [],
        error: null,
      }
    }
    if (table === 'market_download_events' && isInsert) {
      events.push('download-recorded')
      return { data: null, error: null }
    }
    return { data: null, error: null }
  })
  client.storage = {
    from: () => ({
      createSignedUrl: async () => {
        events.push('signed-url')
        return { data: { signedUrl: 'https://example.invalid/signed' }, error: null }
      },
    }),
  }

  const workspaceSubject = load('src/lib/workspace-subject.ts')
  const categoryTree = load('src/lib/market-category-tree.ts', { '@/lib/workspace-subject': workspaceSubject })
  const itemsServer = load('src/lib/market-items-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => client },
    '@/lib/market-refunds': {},
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': categoryTree,
  })
  const purchase = load('src/lib/market-purchase.ts', { '@/lib/market-items-server': itemsServer })
  const { route } = loadRoute('src/app/api/market/items/[itemId]/download/route.ts', {
    userId: USER_ID,
    admin: { client },
    mocks: {
      '@/lib/market-items-server': itemsServer,
      '@/lib/market-purchase': purchase,
      '@/lib/market-refunds': { hasPendingMarketRefundRequestForTarget: async () => false },
    },
  })

  const request = new Request(`http://localhost/api/market/items/${ITEM_ID}/download?fileId=${FILE_ID}`)
  request.nextUrl = new URL(request.url)
  const run = () => route.GET(request, { params: Promise.resolve({ itemId: ITEM_ID }) })
  return { run, events }
}

const baseItem = { id: ITEM_ID, workspace_subject: 'korean', status: 'published', is_active: true, deleted_at: null }

test('숨김 상품이라도 구매 권한이 있으면 다운로드된다', async () => {
  const { run, events } = loadDownloadRoute({ item: { ...baseItem, status: 'hidden' }, entitled: true })
  const response = await run()
  assert.equal(response.status, 302)
  assert.deepEqual(events, ['signed-url', 'download-recorded'])
})

test('숨김 상품을 사지 않은 사람은 403이고 서명 URL을 만들지 않는다', async () => {
  const { run, events } = loadDownloadRoute({ item: { ...baseItem, status: 'hidden' }, entitled: false })
  const response = await run()
  assert.equal(response.status, 403)
  assert.deepEqual(events, [])
})

test('공개 상품은 지금처럼 권한이 있으면 다운로드된다', async () => {
  const { run } = loadDownloadRoute({ item: baseItem, entitled: true })
  assert.equal((await run()).status, 302)
})

test('삭제·비활성·임시저장·보관 상품과 비활성 파일은 권한이 있어도 404', async () => {
  for (const item of [
    { ...baseItem, deleted_at: '2026-01-01T00:00:00Z' },
    { ...baseItem, is_active: false },
    { ...baseItem, status: 'draft' },
    { ...baseItem, status: 'archived' },
  ]) {
    const { run, events } = loadDownloadRoute({ item, entitled: true })
    assert.equal((await run()).status, 404, JSON.stringify(item))
    assert.deepEqual(events, [])
  }
  const { run } = loadDownloadRoute({ item: { ...baseItem, status: 'hidden' }, entitled: true, fileActive: false })
  assert.equal((await run()).status, 404)
})

test('삭제 route는 서버가 판단한 결과(deleted/hidden)를 그대로 돌려준다', async () => {
  for (const result of ['deleted', 'hidden']) {
    const { route } = loadRoute('src/app/api/admin/market/items/[id]/route.ts', {
      mocks: {
        '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'korean' },
        '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => 'korean' },
        '@/lib/market-item-cleanup': { deleteOrHideMarketItem: async () => ({ result, storageCleanupFailed: false }) },
        '@/lib/market-items-server': { getMarketItemById: async () => ({ id: ITEM_ID, workspace_subject: 'korean' }) },
      },
    })
    const response = await route.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ id: ITEM_ID }) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true, data: { result } })
  }
})
