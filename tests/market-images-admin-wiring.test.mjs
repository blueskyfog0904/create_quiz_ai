import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createFakeAdmin, load, loadRoute, marketImages, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const itemsRoute = read('src/app/api/admin/market/items/route.ts')
const itemRoute = read('src/app/api/admin/market/items/[id]/route.ts')
const bulkRoute = read('src/app/api/admin/market/items/thumbnail/route.ts')
const itemsServer = read('src/lib/market-items-server.ts')
const productsClient = read('src/app/(admin)/admin/market/products/market-products-client.tsx')
const categoriesRoute = read('src/app/api/admin/market-categories/route.ts')
const categoryItemRoute = read('src/app/api/admin/market-categories/items/[itemId]/route.ts')
const categoriesServer = read('src/lib/market-categories-server.ts')
const categoriesClient = read('src/app/(admin)/admin/market-categories/market-categories-client.tsx')
const imageField = read('src/components/admin/market-image-field.tsx')
const library = read('src/components/admin/market-image-library.tsx')

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const IMAGE_ID = '22222222-2222-4222-8222-222222222222'
const FK_MESSAGE = 'insert or update on table "market_items" violates foreign key constraint "market_items_thumbnail_image_id_fkey"'

function fnBody(source, name) {
  return source.match(new RegExp(`export async function ${name}\\([\\s\\S]+?\\n}\\n`))[0]
}

test('items API zod drops thumbnailUrl and accepts thumbnailImageId (uuid | null, optional)', () => {
  for (const source of [itemsRoute, itemRoute]) {
    assert.doesNotMatch(source, /thumbnailUrl|thumbnail_url/)
    assert.match(source, /thumbnailImageId: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/)
    assert.match(source, /thumbnail_image_id: parsed\.data\.thumbnailImageId/)
    assert.match(source, /isMarketImageReferenceError\(error\)[\s\S]+?code: 'IMAGE_NOT_FOUND'[\s\S]+?status: 404/)
  }
  assert.match(itemRoute, /const item = await getMarketItemByIdForAdmin\(id, workspaceSubject\)/)
})

test('item create/update write thumbnail_image_id and never thumbnail_url; update keeps it when undefined', () => {
  const create = fnBody(itemsServer, 'createMarketItem')
  const update = fnBody(itemsServer, 'updateMarketItem')
  for (const body of [create, update]) assert.doesNotMatch(body, /thumbnail_url/)
  assert.match(create, /thumbnail_image_id: input\.thumbnail_image_id \?\? null/)
  assert.match(update, /thumbnail_image_id: input\.thumbnail_image_id === undefined \? current\.thumbnail_image_id : input\.thumbnail_image_id/)
})

test('admin item list/detail embed image paths in one select and expose thumbnailImage + categoryDefaultImage', () => {
  assert.match(itemsServer, /const MARKET_ITEM_ADMIN_SELECT = '\*, thumbnail_image:market_images\(id, storage_path\), category_item:market_category_items\(default_image:market_images\(id, storage_path\)\)'/)
  assert.match(fnBody(itemsServer, 'listMarketItemsForAdmin'), /\.select\(MARKET_ITEM_ADMIN_SELECT\)/)
  assert.match(fnBody(itemsServer, 'getMarketItemByIdForAdmin'), /\.select\(MARKET_ITEM_ADMIN_SELECT\)/)
  assert.match(itemsServer, /thumbnailImage: toRef\(thumbnailImage\)/)
  assert.match(itemsServer, /categoryDefaultImage: toRef\(categoryItem\?\.default_image \?\? null\)/)
  assert.match(itemsServer, /getPublicUrl\(image\.storage_path\)/)
})

test('product edit form has no URL input; it uses the image field, picker and bulk assign route', () => {
  assert.doesNotMatch(productsClient, /thumbnailUrl|thumbnail_url|썸네일 URL|placeholder="https:\/\/\.\.\."/)
  assert.match(productsClient, /thumbnailImageId: string \| null/)
  assert.match(productsClient, /thumbnailImageId: form\.thumbnailImageId/)
  assert.match(productsClient, /<MarketImageField\n\s+label="상품 이미지"/)
  assert.match(productsClient, /이미지 일괄 지정/)
  assert.match(productsClient, /이미지 일괄 해제/)
  assert.match(productsClient, /chunkArray\(itemIds, MARKET_IMAGE_MAX_BULK_ITEM_IDS\)/)
  assert.match(productsClient, /'\/api\/admin\/market\/items\/thumbnail'/)
  assert.match(productsClient, /body: JSON\.stringify\(\{ itemIds: chunk, imageId: image\?\.id \?\? null \}\)/)
  assert.match(productsClient, /<MarketImagePicker\n\s+open=\{isBulkImagePickerOpen\}/)
  assert.match(productsClient, /선택한 상품 \$\{bulkImageTarget\.itemIds\.length\}개에 이 이미지를 지정할까요\?/)
})

test('image field offers preview, picker selection, direct upload via the shared flow and removal', () => {
  assert.match(imageField, /<MarketImagePicker/)
  assert.match(imageField, /uploadMarketImageFiles\(\[file\], folderId, \{\n\s+prepare: shrinkMarketImageForUpload,\n\s+hash: sha256HexOfBlob,/)
  for (const label of ['이미지 선택', '새로 업로드', '제거', '이미 등록된 이미지를 재사용했습니다']) assert.ok(imageField.includes(label), label)
  assert.match(imageField, /onClick=\{\(\) => onChange\(null\)\}/)
  assert.ok((imageField.match(/min-h-11/g) ?? []).length >= 3)
  assert.doesNotMatch(imageField, /#[0-9a-fA-F]{3,8}\b|rounded-\[/)
})

test('bulk thumbnail route is admin-only on nodejs, capped at 200 ids and scoped to live items of the workspace', () => {
  assert.match(bulkRoute, /export const runtime = 'nodejs'/)
  assert.match(bulkRoute, /const auth = await requireMarketImageAdmin\(\)\n\s+if \(auth instanceof NextResponse\) return auth/)
  assert.match(bulkRoute, /z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)\.max\(MARKET_IMAGE_MAX_BULK_ITEM_IDS\)/)
  assert.equal(marketImages.MARKET_IMAGE_MAX_BULK_ITEM_IDS, 200)
  assert.match(bulkRoute, /imageId: z\.string\(\)\.uuid\(\)\.nullable\(\)/)
})

test('category items accept default_image_id and the admin tree returns defaultImage', () => {
  assert.match(categoryItemRoute, /default_image_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/)
  assert.match(categoryItemRoute, /defaultImageId: parsed\.data\.default_image_id/)
  assert.match(categoriesServer, /default_image:market_images\(id, storage_path\)/)
  assert.match(categoriesRoute, /defaultImage: item\.default_image/)
  assert.match(categoriesClient, /<MarketImageField[\s\S]+?onChange=\{\(image\) => void patchItem\(item\.id, \{ default_image_id: image\?\.id \?\? null \}\)\}/)
  assert.match(productsClient, /defaultImage: MarketImageFieldValue \| null/)
})

function loadBulkRoute(handler, options = {}) {
  const admin = createFakeAdmin(handler)
  const { route } = loadRoute('src/app/api/admin/market/items/thumbnail/route.ts', {
    admin,
    ...options,
    mocks: { '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: (value) => value || 'english' } },
  })
  return { route, admin }
}

const bulkRequest = (body, subject = 'korean') => new Request(`http://localhost/api/admin/market/items/thumbnail?subject=${subject}`, {
  method: 'POST',
  body: JSON.stringify(body),
})

test('bulk assign: 401/403, cap, success count with filters, clearing, unknown image 404', async () => {
  for (const [options, status] of [[{ loggedIn: false }, 401], [{ isAdmin: false }, 403]]) {
    const { route, admin } = loadBulkRoute(() => { throw new Error('must not query') }, options)
    assert.equal((await route.POST(bulkRequest({ itemIds: [ITEM_ID], imageId: IMAGE_ID }))).status, status)
    assert.deepEqual(admin.calls, [])
  }

  const ids = (count) => Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  const { route, admin } = loadBulkRoute(({ ops }) => ({ data: op(ops, 'in')[2].map((id) => ({ id })), error: null }))
  assert.equal((await route.POST(bulkRequest({ itemIds: ids(201), imageId: IMAGE_ID }))).status, 400)
  assert.equal(admin.calls.length, 0)

  const ok = await route.POST(bulkRequest({ itemIds: ids(200), imageId: IMAGE_ID }))
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).data.updatedCount, 200)
  const ops = admin.calls[0].ops
  assert.equal(op(ops, 'update')[1].thumbnail_image_id, IMAGE_ID)
  assert.equal(op(ops, 'update')[1].updated_by, '00000000-0000-4000-8000-000000000001')
  assert.deepEqual(op(ops, 'eq'), ['eq', 'workspace_subject', 'korean'])
  assert.deepEqual(op(ops, 'is'), ['is', 'deleted_at', null])

  const cleared = await route.POST(bulkRequest({ itemIds: [ITEM_ID, ITEM_ID], imageId: null }))
  assert.equal(cleared.status, 200)
  assert.equal(op(admin.calls[1].ops, 'update')[1].thumbnail_image_id, null)
  assert.deepEqual(op(admin.calls[1].ops, 'in')[2], [ITEM_ID])

  const { route: failing } = loadBulkRoute(() => ({ data: null, error: { code: '23503', message: FK_MESSAGE } }))
  const missing = await failing.POST(bulkRequest({ itemIds: [ITEM_ID], imageId: IMAGE_ID }))
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'IMAGE_NOT_FOUND')
})

function loadItemsRoute(path, itemsServerMock) {
  return loadRoute(path, {
    mocks: {
      '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: (value) => value || 'korean' },
      '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => 'korean' },
      '@/lib/market-menu-server': { listMarketMenuEntriesForAdmin: async () => [{ id: ITEM_ID, deleted_at: null }] },
      '@/lib/market-item-cleanup': {},
      '@/lib/market-items-server': itemsServerMock,
    },
  }).route
}

const baseBody = { menuEntryId: ITEM_ID, title: '상품', pdfPrice: 0, hwpPrice: 0, zipPrice: 0 }

test('item create passes thumbnailImageId, ignores legacy thumbnailUrl and maps a missing image to 404', async () => {
  const calls = []
  const route = loadItemsRoute('src/app/api/admin/market/items/route.ts', {
    createMarketItem: async (input) => {
      calls.push(input)
      if (input.thumbnail_image_id === IMAGE_ID) throw new Error(FK_MESSAGE)
      return { id: 'new' }
    },
    listMarketItemsForAdmin: async () => [],
  })
  const post = (body) => route.POST(new Request('http://localhost/api/admin/market/items?subject=korean', { method: 'POST', body: JSON.stringify(body) }))

  const created = await post({ ...baseBody, thumbnailUrl: 'https://legacy.example/a.png', thumbnailImageId: null })
  assert.equal(created.status, 201)
  assert.equal(calls[0].thumbnail_image_id, null)
  assert.equal('thumbnail_url' in calls[0], false)

  const missing = await post({ ...baseBody, thumbnailImageId: IMAGE_ID })
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'IMAGE_NOT_FOUND')

  assert.equal((await post({ ...baseBody, thumbnailImageId: 'not-a-uuid' })).status, 400)
})

test('item update leaves the image unchanged when thumbnailImageId is omitted', async () => {
  const calls = []
  const route = loadItemsRoute('src/app/api/admin/market/items/[id]/route.ts', {
    getMarketItemById: async () => ({ id: ITEM_ID, workspace_subject: 'korean' }),
    updateMarketItem: async (_id, input) => {
      calls.push(input)
      return { id: ITEM_ID }
    },
  })
  const patch = (body) => route.PATCH(
    new Request('http://localhost/api/admin/market/items/x?subject=korean', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ITEM_ID }) },
  )
  assert.equal((await patch(baseBody)).status, 200)
  assert.equal(calls[0].thumbnail_image_id, undefined)
  assert.equal((await patch({ ...baseBody, thumbnailImageId: IMAGE_ID })).status, 200)
  assert.equal(calls[1].thumbnail_image_id, IMAGE_ID)
})

test('category item update writes default_image_id and maps the image FK error to 404', async () => {
  let updateResult = { data: { id: ITEM_ID }, error: null }
  const admin = createFakeAdmin(() => updateResult)
  const server = load('src/lib/market-categories-server.ts', {
    'server-only': {},
    '@/lib/market-sample-pages-server': {},
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/workspace-subject': { isWorkspaceSubject: () => true },
    '@/lib/list-pagination': {},
    '@/lib/read-all-query-rows': {},
    '@/lib/market-images': marketImages,
  })
  await server.updateCategoryItem(ITEM_ID, { defaultImageId: IMAGE_ID })
  assert.deepEqual(op(admin.calls[0].ops, 'update')[1], { default_image_id: IMAGE_ID })
  await server.updateCategoryItem(ITEM_ID, { defaultImageId: null })
  assert.deepEqual(op(admin.calls[1].ops, 'update')[1], { default_image_id: null })

  updateResult = { data: null, error: { code: '23503', message: 'violates foreign key constraint "market_category_items_default_image_id_fkey"' } }
  await assert.rejects(() => server.updateCategoryItem(ITEM_ID, { defaultImageId: IMAGE_ID }), (error) => error.status === 404)
})

test('review fixes: group update has no image column, drafts merge, preview follows the form id, stale folder is forgotten', () => {
  const groupUpdate = fnBody(categoriesServer, 'updateCategoryGroup')
  assert.doesNotMatch(groupUpdate, /default_image|defaultImage/)

  assert.match(categoriesClient, /const loadGroups = useCallback\(async \(resetId\?: string\) =>/)
  assert.match(categoriesClient, /await loadGroups\(savingKey\)/)
  assert.match(categoriesClient, /isDirty && row\.id !== resetId \? draft : \{ title: row\.title, sortOrder: String\(row\.sortOrder\) \}/)

  assert.match(productsClient, /initialItems: MarketItemForAdmin\[\]/)
  assert.match(productsClient, /const listed = items\.find\(\(item\) => item\.id === form\.id\)\?\.thumbnailImage \?\? null/)
  assert.match(productsClient, /value=\{thumbnailFieldValue\}/)
  assert.match(productsClient, /setBulkImageTarget\(null\)\n\s+setSelectedItemIds\(\[\]\)/)

  assert.match(imageField, /if \(outcome\.folderFallback\) \{\n\s+writeLastMarketImageFolder\('all'\)/)
  assert.match(library, /writeLastMarketImageFolder\(outcome\.folderFallback \? 'all' : uploadFolderId\)/)
  assert.match(library, /!nextFolders\.some\(\(folder\) => folder\.id === remembered\)\) \{\n\s+writeLastMarketImageFolder\('all'\)/)
})
