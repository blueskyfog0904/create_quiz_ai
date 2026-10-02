import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createFakeAdmin, loadRoute, op } from './helpers/market-images-harness.mjs'

const IMAGE_ID = '11111111-1111-4111-8111-111111111111'
const FOLDER_ID = '22222222-2222-4222-8222-222222222222'
const ctx = (id) => ({ params: Promise.resolve({ id }) })

async function png(width = 40, height = 30, compressionLevel = 6) {
  return sharp({ create: { width, height, channels: 3, background: '#4488cc' } }).png({ compressionLevel }).toBuffer()
}

// market_images 행을 메모리에 두는 업로드용 가짜 DB
function imageStore({ insertError } = {}) {
  const rows = []
  const handler = ({ table, ops }) => {
    if (table === 'market_image_folders') {
      return { data: op(ops, 'eq')?.[2] === FOLDER_ID ? { id: FOLDER_ID } : null, error: null }
    }
    if (op(ops, 'insert')) {
      const error = insertError?.()
      if (error) return { data: null, error }
      const row = { id: `00000000-0000-4000-8000-00000000000${rows.length + 2}`, created_at: new Date().toISOString(), ...op(ops, 'insert')[1] }
      rows.push(row)
      return { data: row, error: null }
    }
    const [, column, value] = op(ops, 'eq')
    return { data: rows.find((row) => row[column] === value) ?? null, error: null }
  }
  return { rows, handler }
}

function uploadRequest(files, { folderId, contentLength } = {}) {
  const body = new FormData()
  for (const [bytes, name] of files) body.append('files', new File([bytes], name, { type: 'image/png' }))
  if (folderId) body.append('folderId', folderId)
  const headers = contentLength ? { 'content-length': String(contentLength) } : undefined
  return new Request('http://localhost/api/admin/market/images', { method: 'POST', body, headers })
}

test('every image and folder route returns 401/403 before touching the service-role client', async () => {
  const routes = [
    ['src/app/api/admin/market/images/route.ts', ['GET', 'POST']],
    ['src/app/api/admin/market/images/check/route.ts', ['POST']],
    ['src/app/api/admin/market/images/move/route.ts', ['POST']],
    ['src/app/api/admin/market/images/[id]/route.ts', ['PATCH', 'DELETE']],
    ['src/app/api/admin/market/image-folders/route.ts', ['GET', 'POST']],
    ['src/app/api/admin/market/image-folders/[id]/route.ts', ['PATCH', 'DELETE']],
  ]
  for (const [path, methods] of routes) {
    for (const [options, status] of [[{ loggedIn: false }, 401], [{ isAdmin: false }, 403]]) {
      const admin = createFakeAdmin(() => { throw new Error('service role must not be used') })
      const { route } = loadRoute(path, { ...options, admin })
      for (const method of methods) {
        const response = await route[method](new Request('http://localhost/x', { method }), ctx(IMAGE_ID))
        assert.equal(response.status, status, `${method} ${path}`)
      }
      assert.deepEqual(admin.calls, [])
    }
  }
})

test('uploading the same file twice stores once and returns duplicated on the second upload', async () => {
  const store = imageStore()
  const admin = createFakeAdmin(store.handler)
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const bytes = await png(1200, 600)

  const first = await (await route.POST(uploadRequest([[bytes, 'cover.png']], { folderId: FOLDER_ID }))).json()
  assert.equal(first.data.results[0].duplicated, false)
  const image = first.data.results[0].image
  assert.equal(image.folderId, FOLDER_ID)
  assert.equal(image.displayName, 'cover')
  assert.equal(image.width, 800)
  assert.match(image.storagePath, /^thumbnails\/([0-9a-f]{2})\/\1[0-9a-f]{62}\.webp$/)
  assert.equal(image.publicUrl, `https://project.supabase.co/storage/v1/object/public/market-images/${image.storagePath}`)

  const uploads = admin.calls.filter((call) => call.type === 'upload')
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].bucket, 'market-images')
  assert.deepEqual(uploads[0].options, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })

  const callsBeforeSecond = admin.calls.length
  const second = await (await route.POST(uploadRequest([[bytes, 'other-name.png']]))).json()
  assert.equal(second.data.results[0].duplicated, true)
  const secondLookups = admin.calls.slice(callsBeforeSecond).map((call) => op(call.ops ?? [], 'eq')?.[1])
  assert.deepEqual(secondLookups, ['source_sha256'])
  assert.equal(second.data.results[0].image.id, image.id)
  assert.equal(admin.calls.filter((call) => call.type === 'upload').length, 1)
  assert.equal(store.rows.length, 1)
})

test('different source bytes with the same normalized content reuse the row via content_sha256', async () => {
  const store = imageStore()
  const admin = createFakeAdmin(store.handler)
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  await route.POST(uploadRequest([[await png(500, 300, 1), 'a.png']]))
  const result = await (await route.POST(uploadRequest([[await png(500, 300, 9), 'b.png']]))).json()
  assert.equal(result.data.results[0].duplicated, true)
  assert.equal(store.rows.length, 1)
  assert.equal(admin.calls.filter((call) => call.type === 'upload').length, 1)
})

test('existing storage object is treated as success; DB failure then does not remove it', async () => {
  const store = imageStore({ insertError: () => ({ code: '57014', message: 'timeout' }) })
  const admin = createFakeAdmin(store.handler, { upload: () => ({ statusCode: '409', message: 'The resource already exists' }) })
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const result = await (await route.POST(uploadRequest([[await png(), 'a.png']]))).json()
  assert.match(result.data.results[0].error, /저장하지 못했습니다/)
  assert.equal(admin.calls.some((call) => call.type === 'remove'), false)
})

test('existing storage object with a successful insert adopts the object as a new row', async () => {
  const store = imageStore()
  const admin = createFakeAdmin(store.handler, { upload: () => ({ statusCode: '409', message: 'The resource already exists' }) })
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const result = await (await route.POST(uploadRequest([[await png(), 'a.png']]))).json()
  assert.equal(result.data.results[0].duplicated, false)
  assert.equal(store.rows.length, 1)
  assert.equal(result.data.results[0].image.storagePath, store.rows[0].storage_path)
})

test('DB failure cleanup skips removal when another row already uses the storage path', async () => {
  const store = imageStore({ insertError: () => ({ code: '57014', message: 'timeout' }) })
  const admin = createFakeAdmin(({ table, ops }) => {
    if (table === 'market_images' && op(ops, 'eq')?.[1] === 'storage_path') return { data: { id: IMAGE_ID }, error: null }
    return store.handler({ table, ops })
  })
  const { route, errors } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const result = await (await route.POST(uploadRequest([[await png(), 'a.png']]))).json()
  assert.match(result.data.results[0].error, /저장하지 못했습니다/)
  assert.equal(admin.calls.some((call) => call.type === 'remove'), false)
  assert.ok(errors.some(([message]) => /삭제를 건너뜁니다/.test(message)))
})

test('DB failure after this request created the object removes only that object', async () => {
  const store = imageStore({ insertError: () => ({ code: '57014', message: 'timeout' }) })
  const admin = createFakeAdmin(store.handler)
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const response = await route.POST(uploadRequest([[await png(), 'a.png']]))
  assert.equal(response.status, 200)
  const upload = admin.calls.find((call) => call.type === 'upload')
  const remove = admin.calls.find((call) => call.type === 'remove')
  assert.deepEqual(remove.paths, [upload.path])
})

test('unique violation on insert returns the concurrently saved row without removing the object', async () => {
  let concurrent = null
  const store = imageStore({
    insertError: () => {
      concurrent = { id: IMAGE_ID, created_at: '2026-10-02T00:00:00Z', ...op(lastInsertOps, 'insert')[1] }
      return { code: '23505', message: 'duplicate key' }
    },
  })
  let lastInsertOps = null
  const admin = createFakeAdmin(({ table, ops }) => {
    if (op(ops, 'insert')) lastInsertOps = ops
    if (table === 'market_images' && !op(ops, 'insert') && concurrent && op(ops, 'eq')?.[1] === 'content_sha256') {
      return { data: concurrent, error: null }
    }
    return store.handler({ table, ops })
  })
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const result = await (await route.POST(uploadRequest([[await png(), 'a.png']]))).json()
  assert.equal(result.data.results[0].duplicated, true)
  assert.equal(result.data.results[0].image.id, IMAGE_ID)
  assert.equal(admin.calls.some((call) => call.type === 'remove'), false)
})

test('invalid files get a per-file error, oversized requests 413, unknown folder 404', async () => {
  const store = imageStore()
  const admin = createFakeAdmin(store.handler)
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })

  const mixed = await (await route.POST(uploadRequest([[Buffer.from('nope'), 'bad.png'], [await png(), 'ok.png']]))).json()
  assert.match(mixed.data.results[0].error, /이미지를 읽을 수 없습니다/)
  assert.equal(mixed.data.results[1].duplicated, false)
  assert.equal(admin.calls.filter((call) => call.type === 'upload').length, 1)

  assert.equal((await route.POST(uploadRequest([[await png(), 'a.png']], { contentLength: 5 * 1024 * 1024 }))).status, 413)
  assert.equal((await route.POST(uploadRequest([[await png(), 'a.png']], { folderId: IMAGE_ID }))).status, 404)
  assert.equal((await route.POST(uploadRequest([]))).status, 400)

  const uploadsBefore = admin.calls.filter((call) => call.type === 'upload').length
  const tooMany = await route.POST(uploadRequest(Array.from({ length: 21 }, (_, index) => [Buffer.from('x'), `${index}.png`])))
  assert.equal(tooMany.status, 400)
  assert.equal((await tooMany.json()).error.code, 'TOO_MANY_FILES')
  assert.equal(admin.calls.filter((call) => call.type === 'upload').length, uploadsBefore)
})

test('unexpected sharp errors are logged but still shown as the input error message', async () => {
  const admin = createFakeAdmin(imageStore().handler)
  const { route, errors } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const result = await (await route.POST(uploadRequest([[Buffer.from('not an image'), 'bad.png']]))).json()
  assert.match(result.data.results[0].error, /이미지를 읽을 수 없습니다/)
  assert.ok(errors.some(([message]) => message === '상품 이미지 정규화에 실패했습니다.'))
})

test('list filters unfiled images, pages by offset cursor, and reports usage and totals', async () => {
  const rows = Array.from({ length: 61 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    folder_id: null,
    display_name: `image-${index}`,
    storage_path: `thumbnails/aa/${'a'.repeat(63)}${index % 10}.webp`,
    width: 10,
    height: 10,
    bytes: 100,
    created_at: '2026-10-02T00:00:00Z',
  }))
  const seen = []
  const admin = createFakeAdmin(({ table, ops }) => {
    seen.push({ table, ops })
    if (table === 'market_items') return { data: [{ id: 'item-1', title: '상품', thumbnail_image_id: rows[0].id }], error: null }
    if (table === 'market_category_items') return { data: [{ id: 'cat-1', title: '항목', default_image_id: rows[0].id }], error: null }
    if (op(ops, 'select')[1] === 'bytes') return { data: rows.map(({ bytes }) => ({ bytes })), error: null }
    const [, from, to] = op(ops, 'range')
    return { data: rows.slice(from, to + 1), error: null }
  })
  const { route } = loadRoute('src/app/api/admin/market/images/route.ts', { admin })
  const response = await route.GET(new Request('http://localhost/api/admin/market/images?folderId=unfiled&q=50%25&sort=name'))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.data.items.length, 60)
  assert.equal(body.data.nextCursor, '60')
  assert.equal(body.data.items[0].usageCount, 2)
  assert.equal(body.data.items[1].usageCount, 0)
  assert.deepEqual(body.data.totals, { count: 61, bytes: 6100 })

  const list = seen.find(({ table, ops }) => table === 'market_images' && op(ops, 'select')[1] === '*').ops
  assert.deepEqual(op(list, 'is'), ['is', 'folder_id', null])
  assert.deepEqual(op(list, 'ilike'), ['ilike', 'display_name', '%50\\%%'])
  assert.deepEqual(op(list, 'order'), ['order', 'display_name'])
  const items = seen.find(({ table }) => table === 'market_items').ops
  assert.deepEqual(op(items, 'is'), ['is', 'deleted_at', null])

  assert.equal((await route.GET(new Request('http://localhost/x?folderId=bad'))).status, 400)
})

test('delete calls delete_market_image and maps IN_USE / 23503 / NOT_FOUND / success', async () => {
  const usageHandler = ({ table }) => {
    if (table === 'market_items') return { data: [{ id: 'item-1', title: '상품 A', thumbnail_image_id: IMAGE_ID }], error: null }
    if (table === 'market_images') return { data: null, error: null }
    return { data: [], error: null }
  }
  const cases = [
    [{ data: { ok: false, code: 'IN_USE', items: [{ id: 'i', title: 't' }], categoryItems: [] }, error: null }, 409, 'IN_USE'],
    [{ data: null, error: { code: '23503', message: 'fk' } }, 409, 'IN_USE'],
    [{ data: { ok: false, code: 'NOT_FOUND' }, error: null }, 404, 'NOT_FOUND'],
    [{ data: { ok: true, imageId: IMAGE_ID, storagePath: 'thumbnails/ab/x.webp', clearedDeletedItems: 1 }, error: null }, 200, null],
  ]
  for (const [rpcResult, status, code] of cases) {
    const admin = createFakeAdmin(usageHandler, { rpc: () => rpcResult, remove: () => ({ message: 'storage down' }) })
    const { route } = loadRoute('src/app/api/admin/market/images/[id]/route.ts', { admin })
    const response = await route.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(IMAGE_ID))
    const body = await response.json()
    assert.equal(response.status, status)
    assert.deepEqual(admin.calls[0], { type: 'rpc', name: 'delete_market_image', args: { p_image_id: IMAGE_ID } })
    if (code) assert.equal(body.error.code, code)
    if (rpcResult.error?.code === '23503') assert.deepEqual(body.error.items, [{ id: 'item-1', title: '상품 A' }])
    const removes = admin.calls.filter((call) => call.type === 'remove')
    if (status === 200) {
      assert.deepEqual(removes.map((call) => call.paths), [['thumbnails/ab/x.webp']])
      assert.equal(body.data.clearedDeletedItems, 1)
    } else {
      assert.equal(removes.length, 0)
    }
  }
})

test('folder delete returns FOLDER_NOT_EMPTY with imageCount, also when the FK race fires', async () => {
  for (const [counts, deleteResult, status, imageCount] of [
    [[3], null, 409, 3],
    [[0, 2], { data: null, error: { code: '23503', message: 'fk' } }, 409, 2],
    [[0], { data: [{ id: FOLDER_ID }], error: null }, 200, null],
    [[0], { data: [], error: null }, 404, null],
  ]) {
    const admin = createFakeAdmin(({ ops }) => (op(ops, 'delete') ? deleteResult : { count: counts.shift(), error: null }))
    const { route } = loadRoute('src/app/api/admin/market/image-folders/[id]/route.ts', { admin })
    const response = await route.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(FOLDER_ID))
    const body = await response.json()
    assert.equal(response.status, status)
    if (status === 409) {
      assert.equal(body.error.code, 'FOLDER_NOT_EMPTY')
      assert.equal(body.error.imageCount, imageCount)
    }
    if (counts.length === 0 && deleteResult === null) {
      assert.equal(admin.calls.some(({ ops }) => ops && op(ops, 'delete')), false)
    }
  }
})

test('folder create/rename trims names, rejects >60 chars and maps duplicate names to 409', async () => {
  const admin = createFakeAdmin(() => ({ data: null, error: { code: '23505', message: 'dup' } }))
  const { route } = loadRoute('src/app/api/admin/market/image-folders/route.ts', { admin })
  const post = (name) => route.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ name }) }))
  assert.equal((await post('  수능특강  ')).status, 409)
  assert.equal(op(admin.calls[0].ops, 'insert')[1].name, '수능특강')
  assert.equal((await post('   ')).status, 400)
  assert.equal((await post('가'.repeat(61))).status, 400)

  const { route: folder } = loadRoute('src/app/api/admin/market/image-folders/[id]/route.ts', { admin })
  const patch = await folder.PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ name: '독서' }) }), ctx(FOLDER_ID))
  assert.equal(patch.status, 409)
})

test('check matches by source or content hash; move and rename map unknown folders to 404', async () => {
  const hash = 'b'.repeat(64)
  const admin = createFakeAdmin(({ ops }) => {
    if (op(ops, 'or')) return { data: [{ id: IMAGE_ID, source_sha256: 'c'.repeat(64), content_sha256: hash, storage_path: 'p' }], error: null }
    return { data: null, error: { code: '23503', message: 'fk' } }
  })
  const { route: check } = loadRoute('src/app/api/admin/market/images/check/route.ts', { admin })
  const checked = await (await check.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ hashes: [hash, 'd'.repeat(64)] }) }))).json()
  assert.deepEqual(checked.data.matches.map((match) => [match.hash, match.image.id]), [[hash, IMAGE_ID]])
  assert.equal(op(admin.calls[0].ops, 'or')[1], `source_sha256.in.(${hash},${'d'.repeat(64)}),content_sha256.in.(${hash},${'d'.repeat(64)})`)
  assert.equal((await check.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ hashes: ['x'] }) }))).status, 400)

  const { route: move } = loadRoute('src/app/api/admin/market/images/move/route.ts', { admin })
  const moved = await move.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ imageIds: [IMAGE_ID], folderId: FOLDER_ID }) }))
  assert.equal(moved.status, 404)

  const { route: image } = loadRoute('src/app/api/admin/market/images/[id]/route.ts', { admin })
  const renamed = await image.PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ folderId: FOLDER_ID }) }), ctx(IMAGE_ID))
  assert.equal(renamed.status, 404)
  const empty = await image.PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({}) }), ctx(IMAGE_ID))
  assert.equal(empty.status, 400)
})

test('delete skips storage removal when a row re-uploaded the same path after the RPC', async () => {
  const admin = createFakeAdmin(
    ({ table, ops }) => (table === 'market_images' && op(ops, 'eq')?.[1] === 'storage_path'
      ? { data: { id: FOLDER_ID }, error: null }
      : { data: [], error: null }),
    { rpc: () => ({ data: { ok: true, imageId: IMAGE_ID, storagePath: 'thumbnails/ab/x.webp', clearedDeletedItems: 0 }, error: null }) },
  )
  const { route, errors } = loadRoute('src/app/api/admin/market/images/[id]/route.ts', { admin })
  const response = await route.DELETE(new Request('http://localhost/x', { method: 'DELETE' }), ctx(IMAGE_ID))
  assert.equal(response.status, 200)
  assert.equal(admin.calls.some((call) => call.type === 'remove'), false)
  assert.ok(errors.some(([message]) => /삭제를 건너뜁니다/.test(message)))
})

test('move accepts up to 200 image ids and rejects more before querying', async () => {
  const admin = createFakeAdmin(({ ops }) => ({ data: op(ops, 'in')[2].map((id) => ({ id })), error: null }))
  const { route } = loadRoute('src/app/api/admin/market/images/move/route.ts', { admin })
  const ids = (count) => Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  const move = (imageIds) => route.POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ imageIds, folderId: null }) }))
  const ok = await move(ids(200))
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).data.movedCount, 200)
  assert.equal((await move(ids(201))).status, 400)
  assert.equal(admin.calls.length, 1)
})
