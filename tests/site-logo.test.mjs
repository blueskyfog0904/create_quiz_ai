import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
function load(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', 'console', outputText)(
    (name) => mocks[name] ?? require(name), loaded, loaded.exports, { error() {} }
  )
  return loaded.exports
}
const constants = load('src/lib/site-logo.ts')
const imageModule = load('src/lib/site-logo-image.ts', { './site-logo': constants })
const { normalizeSiteLogo } = imageModule

async function makeImage(width, height, format = 'png') {
  const bytes = await sharp({ create: { width, height, channels: 4, background: '#ff0000' } })
    .toFormat(format).toBuffer()
  return new File([bytes], `logo.${format}`, { type: `image/${format}` })
}

for (const [width, height, format] of [[800, 200, 'png'], [200, 800, 'jpeg'], [24, 24, 'webp'], [256, 256, 'png']]) {
  test(`${width}x${height} ${format}: normalized PNG keeps aspect ratio and transparent padding`, async () => {
    const buffer = await normalizeSiteLogo(await makeImage(width, height, format))
    const metadata = await sharp(buffer).metadata()
    assert.equal(metadata.width, 256)
    assert.equal(metadata.height, 256)
    assert.equal(metadata.format, 'png')
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3]
    assert.equal(alphaAt(128, 128), 255)
    if (width > height) {
      assert.equal(alphaAt(128, 0), 0)
      assert.equal(alphaAt(0, 128), 255)
      assert.equal(alphaAt(128, 95), 0)
      assert.equal(alphaAt(128, 96), 255)
    } else if (height > width) {
      assert.equal(alphaAt(0, 128), 0)
      assert.equal(alphaAt(128, 0), 255)
    } else {
      assert.equal(alphaAt(0, 0), 255)
    }
  })
}

test('rotation metadata is applied and source transparency is preserved', async () => {
  const rotated = await sharp({ create: { width: 800, height: 200, channels: 3, background: 'red' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const output = await normalizeSiteLogo(new File([rotated], 'rotated.jpg', { type: 'image/jpeg' }))
  const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(data[(128 * 256) * 4 + 3], 0)
  assert.equal(data[128 * 4 + 3], 255)
  const transparent = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#00000000' } }).png().toBuffer()
  const stats = await sharp(await normalizeSiteLogo(new File([transparent], 'alpha.png', { type: 'image/png' }))).stats()
  assert.equal(stats.channels[3].max, 0)
})

test('invalid, oversized, empty, disguised SVG and excessive-pixel images are rejected', async () => {
  for (const file of [
    new File(['x'], 'bad.gif', { type: 'image/gif' }),
    new File([], 'empty.png', { type: 'image/png' }),
    new File(['not an image'], 'bad.png', { type: 'image/png' }),
    new File([Buffer.alloc(constants.SITE_LOGO_MAX_BYTES + 1)], 'big.png', { type: 'image/png' }),
    new File(['<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>'], 'fake.png', { type: 'image/png' }),
    await makeImage(5001, 5000),
  ]) await assert.rejects(() => normalizeSiteLogo(file))
})

function routeHarness({ loggedIn = true, isAdmin = true, uploadFails = false, saveFails = false } = {}) {
  const calls = []
  const storage = {
    async upload(path, buffer, options) { calls.push({ type: 'upload', path, buffer, options }); return { error: uploadFails ? new Error('upload failed') : null } },
    async remove(paths) { calls.push({ type: 'remove', paths }); return { error: null } },
    getPublicUrl(path) { return { data: { publicUrl: `https://assets.example/${path}` } } },
  }
  const { POST } = load('src/app/api/admin/site-logo/route.ts', {
    '@/lib/site-logo': constants,
    '@/lib/site-logo-image': imageModule,
    '@/lib/main-ad-carousel': { MAIN_AD_IMAGES_BUCKET: 'main-ad-images' },
    'next/server': { NextResponse: { json: (data, options) => Response.json(data, options) } },
    'next/cache': {
      revalidateTag: (...args) => calls.push({ type: 'tag', args }),
      revalidatePath: (...args) => calls.push({ type: 'path', args }),
    },
    '@/lib/supabase/server': { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: loggedIn ? { id: 'test-admin' } : null } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: isAdmin } }) }) }) }),
    }) },
    '@/lib/supabase/bypass': { createAdminClient: () => ({
      storage: { from: () => storage },
      from: () => ({ upsert: async (value) => {
        calls.push({ type: 'save', value })
        return { error: saveFails ? new Error('save failed') : null }
      } }),
    }) },
  })
  return { POST, calls }
}
async function request(file = null) {
  const body = new FormData()
  if (file) body.append('file', file)
  return new Request('http://localhost/api/admin/site-logo', { method: 'POST', body })
}

test('anonymous and non-admin requests cannot write any data', async () => {
  for (const [options, status] of [[{ loggedIn: false }, 401], [{ isAdmin: false }, 403]]) {
    const { POST, calls } = routeHarness(options)
    assert.equal((await POST(await request())).status, status)
    assert.deepEqual(calls, [])
  }
})

test('admin upload persists normalized image, setting and invalidates public caches', async () => {
  const { POST, calls } = routeHarness()
  const response = await POST(await request(await makeImage(600, 100)))
  assert.equal(response.status, 200)
  assert.equal((await sharp(calls[0].buffer).metadata()).width, 256)
  assert.equal(calls[0].options.contentType, 'image/png')
  assert.equal(calls[1].value.value.path, calls[0].path)
  assert.equal(calls[1].value.key, constants.SITE_LOGO_SETTING_KEY)
  assert.deepEqual(calls.map((call) => call.type), ['upload', 'save', 'tag', 'path'])
  assert.deepEqual(calls[2].args, [constants.SITE_LOGO_SETTING_KEY, { expire: 0 }])
  assert.deepEqual(calls[3].args, ['/', 'layout'])
  assert.match((await response.json()).url, /\/site-logo\/.+\.png$/)
})

test('failed upload does not change setting; failed setting removes only its new upload', async () => {
  for (const options of [{ uploadFails: true }, { saveFails: true }]) {
    const { POST, calls } = routeHarness(options)
    assert.equal((await POST(await request(await makeImage(20, 20)))).status, 500)
    assert.deepEqual(calls.map((call) => call.type), options.uploadFails ? ['upload'] : ['upload', 'save', 'remove'])
    if (options.saveFails) assert.deepEqual(calls[2].paths, [calls[0].path])
  }
})

test('missing files and corrupt files do not trigger storage writes', async () => {
  for (const file of [null, new File(['invalid'], 'bad.png', { type: 'image/png' })]) {
    const { POST, calls } = routeHarness()
    assert.equal((await POST(await request(file))).status, 400)
    assert.deepEqual(calls, [])
  }
})
