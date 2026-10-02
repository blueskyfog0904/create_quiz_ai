import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import '../src/components/features/passages/node-test-register.mjs'

// '@/' 별칭 해석 훅이 등록된 뒤에 불러와야 한다(정적 import는 훅보다 먼저 해석된다).
const {
  requestMarketImageJson,
  sha256HexOfBlob,
  uploadMarketImageFiles,
} = await import('../src/lib/market-images-upload.ts')

const MB = 1024 * 1024
const image = (id) => ({ id, displayName: id, publicUrl: `https://cdn.example/${id}.webp` })
const file = (name, size = 10) => new File([Buffer.alloc(size, name)], name, { type: 'image/png' })
const deps = (fetch, overrides = {}) => ({
  fetch,
  prepare: async (input) => input,
  hash: async (input) => `hash-${input.name}`,
  ...overrides,
})

// 호출을 기록하고 경로별 handler 결과를 JSON 응답으로 돌려주는 가짜 fetch
function fakeFetch(handlers) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    const handler = handlers[url]
    const { status = 200, body } = await handler(init, calls)
    return Response.json(body, { status })
  }
  return { fetch, calls }
}

function uploadedNames(init) {
  return init.body.getAll('files').map((entry) => entry.name)
}

test('known hashes are reused without upload; server duplicates also count as reused; order follows input', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/admin/market/images/check': () => ({ body: { success: true, data: { matches: [{ hash: 'hash-b.png', image: image('B') }] } } }),
    '/api/admin/market/images': (init) => ({
      body: {
        success: true,
        data: {
          results: uploadedNames(init).map((name) => (name === 'c.png'
            ? { name, image: image('C'), duplicated: true }
            : { name, image: image(name.toUpperCase()[0]), duplicated: false })),
        },
      },
    }),
  })
  const outcome = await uploadMarketImageFiles([file('a.png'), file('b.png'), file('c.png')], 'folder-1', deps(fetch))
  assert.deepEqual(outcome.images.map((entry) => entry.id), ['A', 'B', 'C'])
  assert.equal(outcome.reusedCount, 2)
  assert.deepEqual(outcome.failures, [])

  assert.deepEqual(JSON.parse(calls[0].init.body), { hashes: ['hash-a.png', 'hash-b.png', 'hash-c.png'] })
  assert.equal(calls[1].url, '/api/admin/market/images')
  assert.deepEqual(uploadedNames(calls[1].init), ['a.png', 'c.png'])
  assert.equal(calls[1].init.body.get('folderId'), 'folder-1')
})

test('select mode gets the single uploaded or reused image as the first result', async () => {
  for (const reused of [true, false]) {
    const { fetch } = fakeFetch({
      '/api/admin/market/images/check': () => ({ body: { success: true, data: { matches: reused ? [{ hash: 'hash-x.png', image: image('X') }] : [] } } }),
      '/api/admin/market/images': () => ({ body: { success: true, data: { results: [{ name: 'x.png', image: image('X'), duplicated: false }] } } }),
    })
    const outcome = await uploadMarketImageFiles([file('x.png')], null, deps(fetch))
    assert.equal(outcome.images[0].id, 'X')
  }
})

test('a failed batch maps its error to every file in that batch; per-file errors and prepare failures are kept', async () => {
  let batch = 0
  const { fetch, calls } = fakeFetch({
    '/api/admin/market/images/check': () => ({ body: { success: true, data: { matches: [] } } }),
    '/api/admin/market/images': (init) => {
      batch += 1
      if (batch === 1) return { status: 413, body: { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: '너무 큽니다' } } }
      return { body: { success: true, data: { results: uploadedNames(init).map((name) => ({ name, error: '형식 오류' })) } } }
    },
  })
  const files = [file('a.png', 3 * MB), file('b.png', 2 * MB), file('broken.png')]
  const outcome = await uploadMarketImageFiles(files, null, deps(fetch, {
    prepare: async (input) => {
      if (input.name === 'broken.png') throw new Error('줄이지 못했습니다')
      return input
    },
  }))
  assert.deepEqual(calls.filter((call) => call.url === '/api/admin/market/images').map((call) => uploadedNames(call.init)), [['a.png'], ['b.png']])
  assert.deepEqual(outcome.failures, [
    { name: 'broken.png', error: '줄이지 못했습니다' },
    { name: 'a.png', error: '너무 큽니다' },
    { name: 'b.png', error: '형식 오류' },
  ])
  assert.deepEqual(outcome.images, [])
})

test('check requests are chunked to 100 unique hashes and uploads to 20 files per request', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/admin/market/images/check': () => ({ body: { success: true, data: { matches: [] } } }),
    '/api/admin/market/images': (init) => ({
      body: { success: true, data: { results: uploadedNames(init).map((name) => ({ name, image: image(name), duplicated: false })) } },
    }),
  })
  const files = Array.from({ length: 205 }, (_, index) => file(`f${index}.png`))
  const outcome = await uploadMarketImageFiles(files, null, deps(fetch))
  const checks = calls.filter((call) => call.url.endsWith('/check')).map((call) => JSON.parse(call.init.body).hashes.length)
  assert.deepEqual(checks, [100, 100, 5])
  const uploads = calls.filter((call) => call.url === '/api/admin/market/images').map((call) => uploadedNames(call.init).length)
  assert.equal(uploads.length, 11)
  assert.ok(uploads.every((count) => count <= 20))
  assert.equal(outcome.images.length, 205)
  assert.equal(outcome.images[0].id, 'f0.png')
})

test('check failure aborts before any upload', async () => {
  const { fetch, calls } = fakeFetch({
    '/api/admin/market/images/check': () => ({ status: 500, body: { success: false, error: { message: '확인 실패' } } }),
  })
  await assert.rejects(() => uploadMarketImageFiles([file('a.png')], null, deps(fetch)), /확인 실패/)
  assert.equal(calls.length, 1)
})

test('requestMarketImageJson turns network errors and non-success bodies into failure results', async () => {
  const network = await requestMarketImageJson('/x', undefined, async () => { throw new TypeError('Failed to fetch') })
  assert.equal(network.ok, false)
  assert.equal(network.result.error.code, 'NETWORK_ERROR')

  const notJson = await requestMarketImageJson('/x', undefined, async () => new Response('oops', { status: 502 }))
  assert.equal(notJson.ok, false)
  assert.equal(notJson.result, null)

  const unsuccessful = await requestMarketImageJson('/x', undefined, async () => Response.json({ success: false }, { status: 200 }))
  assert.equal(unsuccessful.ok, false)

  const success = await requestMarketImageJson('/x', { method: 'POST' }, async (url, init) => {
    assert.equal(init.cache, 'no-store')
    assert.equal(init.method, 'POST')
    return Response.json({ success: true, data: 1 })
  })
  assert.deepEqual(success, { ok: true, result: { success: true, data: 1 } })
})

test('sha256HexOfBlob hashes exactly the bytes that will be sent', async () => {
  const bytes = Buffer.from('market-image')
  assert.equal(await sha256HexOfBlob(new Blob([bytes])), createHash('sha256').update(bytes).digest('hex'))
})

test('a deleted remembered folder falls back to 미분류 for this and later batches and reports it', async () => {
  const MB4 = 3 * 1024 * 1024
  const folders = []
  const { fetch, calls } = fakeFetch({
    '/api/admin/market/images/check': () => ({ body: { success: true, data: { matches: [] } } }),
    '/api/admin/market/images': (init) => {
      const folderId = init.body.get('folderId')
      folders.push(folderId)
      if (folderId) return { status: 404, body: { success: false, error: { code: 'FOLDER_NOT_FOUND', message: '폴더를 찾을 수 없습니다.' } } }
      return { body: { success: true, data: { results: uploadedNames(init).map((name) => ({ name, image: image(name), duplicated: false })) } } }
    },
  })
  const outcome = await uploadMarketImageFiles([file('a.png', MB4), file('b.png', MB4)], 'deleted-folder', deps(fetch))
  assert.deepEqual(folders, ['deleted-folder', null, null])
  assert.equal(outcome.folderFallback, true)
  assert.deepEqual(outcome.failures, [])
  assert.deepEqual(outcome.images.map((entry) => entry.id), ['a.png', 'b.png'])
  assert.equal(calls.length, 4)

  const { fetch: okFetch } = fakeFetch({
    '/api/admin/market/images/check': () => ({ body: { success: true, data: { matches: [] } } }),
    '/api/admin/market/images': (init) => ({ body: { success: true, data: { results: uploadedNames(init).map((name) => ({ name, image: image(name), duplicated: false })) } } }),
  })
  assert.equal((await uploadMarketImageFiles([file('c.png')], 'folder', deps(okFetch))).folderFallback, false)
})
