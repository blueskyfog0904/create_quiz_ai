import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeAdmin, load, loadRoute, marketImages, op } from './helpers/market-images-harness.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return listSourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const READ_PATHS = [
  'src/lib/market-search-server.ts',
  'src/lib/market-categories-server.ts',
  'src/lib/market-home-server.ts',
  'src/lib/market-items-server.ts',
]

test('no src .ts/.tsx file reads thumbnail_url (generated supabase types excepted)', () => {
  const offenders = listSourceFiles(join(root, 'src'))
    .map((path) => relative(root, path))
    .filter((path) => path !== join('src', 'types', 'supabase.ts'))
    .filter((path) => read(path).includes('thumbnail_url'))
  assert.deepEqual(offenders, [])
})

test('every public read path embeds both image levels in its select and maps through toMarketThumbnailUrl', () => {
  assert.equal(
    marketImages.MARKET_THUMBNAIL_EMBED,
    'thumbnail_image:market_images(storage_path), category_item:market_category_items(default_image:market_images(storage_path))',
  )
  for (const path of READ_PATHS) {
    const source = read(path)
    assert.match(source, /MARKET_THUMBNAIL_EMBED/, path)
    assert.match(source, /thumbnailUrl: (item \? )?toMarketThumbnailUrl\((supabase|client), (item|row)\)/, path)
  }
  const home = read('src/lib/market-home-server.ts')
  assert.equal((home.match(/\.select\(ITEM_SELECT\)/g) ?? []).length, 2, 'home recent + popular')
  const items = read('src/lib/market-items-server.ts')
  assert.equal((items.match(/\.select\(`\*, \$\{MARKET_THUMBNAIL_EMBED\}`\)/g) ?? []).length, 2, 'published detail + library')
  assert.match(items, /export async function getPublishedMarketItemById\([^)]*\): Promise<MarketPublishedItem \| null>/)

  const detail = read('src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')
  assert.match(detail, /item: MarketPublishedItem/)
  assert.match(detail, /\{item\.thumbnailUrl \? \(/)
  assert.match(detail, /src=\{item\.thumbnailUrl\}/)
})

test('public list caches are tagged and admin image writes revalidate that tag', () => {
  assert.match(read('src/lib/preview-home-cache.ts'), /tags: \[MARKET_PUBLIC_LIST_CACHE_TAG\]/)
  for (const path of [
    'src/app/api/admin/market/items/route.ts',
    'src/app/api/admin/market/items/[id]/route.ts',
    'src/app/api/admin/market/items/thumbnail/route.ts',
    'src/app/api/admin/market-categories/[nodeId]/route.ts',
  ]) {
    assert.match(read(path), /revalidateTag\(MARKET_PUBLIC_LIST_CACHE_TAG, \{ expire: 0 \}\)/, path)
  }
})

test('search rows use item image, then category default image, then null — never the legacy column', async () => {
  const path = (name) => `thumbnails/${name.slice(0, 2)}/${name}.webp`
  const items = [
    { id: 'a', title: 'A', menu_entry_id: 'm', view_count: 4, thumbnail_image: { storage_path: path('item1') }, category_item: { default_image: { storage_path: path('cat1') } } },
    { id: 'b', title: 'B', menu_entry_id: 'm', view_count: 3, thumbnail_image: null, category_item: { default_image: { storage_path: path('cat1') } } },
    { id: 'c', title: 'C', menu_entry_id: 'm', view_count: 2, thumbnail_image: null, category_item: null },
    { id: 'd', title: 'D', menu_entry_id: 'm', view_count: 1, thumbnail_image: null, category_item: { default_image: null }, thumbnail_url: 'https://legacy.example/d.png' },
  ]
  const admin = createFakeAdmin(({ table }) => {
    if (table === 'market_items') return { data: items, error: null }
    // 카테고리 칸이 없어도(market_category_items 빈 배열) 썸네일 결과는 같다.
    return { data: [], error: null }
  })
  const server = load('src/lib/market-search-server.ts', {
    'server-only': {},
    '@/lib/market-sample-pages-server': { listActiveMarketItemSamplePagesForItems: async () => new Map() },
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/workspace-subject': { DEFAULT_WORKSPACE_SUBJECT: 'english' },
    '@/lib/list-pagination': load('src/lib/list-pagination.ts'),
    '@/lib/read-all-query-rows': load('src/lib/read-all-query-rows.ts'),
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': load('src/lib/market-category-tree.ts'),
  })
  const result = await server.searchMarketItemsForSubject('english', {})
  const base = 'https://project.supabase.co/storage/v1/object/public/market-images/'
  assert.deepEqual(
    result.rows.map((row) => [row.itemId, row.thumbnailUrl]),
    [['a', `${base}${path('item1')}`], ['b', `${base}${path('cat1')}`], ['c', null], ['d', null]],
  )
  const itemsQuery = admin.calls.find((call) => call.table === 'market_items')
  assert.match(op(itemsQuery.ops, 'select')[1], /thumbnail_image:market_images\(storage_path\), category_item:market_category_items\(default_image:market_images\(storage_path\)\)$/)
  assert.doesNotMatch(op(itemsQuery.ops, 'select')[1], /thumbnail_url/)
})

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const IMAGE_ID = '22222222-2222-4222-8222-222222222222'

test('bulk assign revalidates only when rows changed', async () => {
  for (const [rows, expected] of [[[{ id: ITEM_ID }], 1], [[], 0]]) {
    const { route, revalidations } = loadRoute('src/app/api/admin/market/items/thumbnail/route.ts', {
      admin: createFakeAdmin(() => ({ data: rows, error: null })),
      mocks: { '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'english' } },
    })
    await route.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ itemIds: [ITEM_ID], imageId: IMAGE_ID }) }))
    assert.equal(revalidations.length, expected)
    if (expected) assert.deepEqual(revalidations[0], ['market-public-lists', { expire: 0 }])
  }
})

test('item update revalidates only when the image id or category item actually changes; category node changes revalidate', async () => {
  const CATEGORY_ID = '33333333-3333-4333-8333-333333333333'
  const OTHER_CATEGORY_ID = '44444444-4444-4444-8444-444444444444'
  const itemsServer = (currentImageId) => ({
    getMarketItemById: async () => ({ id: ITEM_ID, workspace_subject: 'english', thumbnail_image_id: currentImageId, category_item_id: CATEGORY_ID }),
    updateMarketItem: async () => ({ id: ITEM_ID }),
  })
  // 화면은 menuEntryId를 보내지 않고, 카테고리는 바뀔 때만 categoryItemId로 보낸다.
  const body = { title: '상품', pdfPrice: 0, hwpPrice: 0, zipPrice: 0 }
  for (const [current, sent, expected, categoryItemId, status = 200] of [
    [null, IMAGE_ID, 1],
    [IMAGE_ID, IMAGE_ID, 0],
    [IMAGE_ID, undefined, 0],
    [IMAGE_ID, null, 1],
    // 카테고리 칸이 바뀌면 대체 이미지(칸 기본 이미지)와 칸별 상품 수가 바뀔 수 있다(목록 + 트리 태그).
    [IMAGE_ID, IMAGE_ID, 2, OTHER_CATEGORY_ID],
    // 카테고리는 필수라 해제(null)는 400이고 아무것도 갱신하지 않는다.
    [IMAGE_ID, IMAGE_ID, 0, null, 400],
    [IMAGE_ID, IMAGE_ID, 0, CATEGORY_ID],
  ]) {
    const { route, revalidations } = loadRoute('src/app/api/admin/market/items/[id]/route.ts', {
      mocks: {
        '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'english' },
        '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => 'english' },
        '@/lib/market-item-cleanup': {},
        '@/lib/market-items-server': itemsServer(current),
      },
    })
    const response = await route.PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ ...body, thumbnailImageId: sent, categoryItemId }) }),
      { params: Promise.resolve({ id: ITEM_ID }) },
    )
    assert.equal(response.status, status, `${current} -> ${sent}, category ${categoryItemId}`)
    assert.equal(revalidations.length, expected, `${current} -> ${sent}, category ${categoryItemId}`)
  }

  // 칸 변경은 공개 트리와 목록 캐시를 항상 함께 갱신한다.
  for (const [patch, expected] of [[{ default_image_id: IMAGE_ID }, 2], [{ title: '제목' }, 2]]) {
    const { route, revalidations } = loadRoute('src/app/api/admin/market-categories/[nodeId]/route.ts', {
      mocks: {
        '@/lib/market-categories-server': {
          MarketCategoryError: class extends Error {},
          deleteCategoryNode: async () => {},
          updateCategoryNode: async () => ({ id: ITEM_ID }),
        },
      },
    })
    const response = await route.PATCH(
      new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(patch) }),
      { params: Promise.resolve({ nodeId: ITEM_ID }) },
    )
    assert.equal(response.status, 200)
    assert.equal(revalidations.length, expected)
  }
})

test('item hard delete revalidates the public list and category tree caches', async () => {
  const { route, revalidations } = loadRoute('src/app/api/admin/market/items/[id]/route.ts', {
    mocks: {
      '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'english' },
      '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => 'english' },
      '@/lib/market-item-cleanup': { hardDeleteMarketItemWithAssets: async () => {} },
      '@/lib/market-items-server': { getMarketItemById: async () => ({ id: ITEM_ID, workspace_subject: 'english' }) },
    },
  })
  const response = await route.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ id: ITEM_ID }) })
  assert.equal(response.status, 200)
  assert.deepEqual(revalidations, [['market-public-lists', { expire: 0 }], ['market-category-tree', { expire: 0 }]])
})
