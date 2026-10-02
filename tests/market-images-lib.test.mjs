import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { NextResponse, load, marketImages } from './helpers/market-images-harness.mjs'

const server = load('src/lib/market-images-server.ts', {
  'server-only': {},
  'next/server': { NextResponse },
  '@/lib/supabase/server': { createClient: async () => { throw new Error('not used') } },
  '@/lib/read-all-query-rows': {},
  '@/lib/market-images': marketImages,
})
const { normalizeMarketImage, MarketImageInputError } = server

function solid(width, height, background = '#3366cc') {
  return sharp({ create: { width, height, channels: 3, background } })
}

test('large PNG becomes WebP with longest edge 800 and matching size/hash fields', async () => {
  const input = await solid(2000, 1000).png().toBuffer()
  const result = await normalizeMarketImage(input)
  const metadata = await sharp(result.buffer).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 800)
  assert.equal(metadata.height, 400)
  assert.equal(result.width, 800)
  assert.equal(result.height, 400)
  assert.equal(result.bytes, result.buffer.length)
  assert.equal(result.contentSha256, createHash('sha256').update(result.buffer).digest('hex'))
})

test('small images are not enlarged', async () => {
  const result = await normalizeMarketImage(await solid(300, 120).jpeg().toBuffer())
  assert.equal(result.width, 300)
  assert.equal(result.height, 120)
})

test('EXIF orientation is applied and metadata is stripped', async () => {
  const input = await solid(1600, 400).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const result = await normalizeMarketImage(input)
  const metadata = await sharp(result.buffer).metadata()
  assert.equal(result.width, 200)
  assert.equal(result.height, 800)
  assert.equal(metadata.orientation, undefined)
  assert.equal(metadata.exif, undefined)
})

test('same input twice and same pixels with different encoding give the same content hash and path', async () => {
  const pixels = solid(900, 600, '#cc8844')
  const fast = await pixels.clone().png({ compressionLevel: 1 }).toBuffer()
  const small = await pixels.clone().png({ compressionLevel: 9 }).toBuffer()
  assert.notDeepEqual(fast, small)
  const [a, b, c] = await Promise.all([normalizeMarketImage(fast), normalizeMarketImage(fast), normalizeMarketImage(small)])
  assert.equal(a.contentSha256, b.contentSha256)
  assert.equal(a.contentSha256, c.contentSha256)
  assert.equal(
    marketImages.buildMarketImageStoragePath(a.contentSha256),
    `thumbnails/${a.contentSha256.slice(0, 2)}/${a.contentSha256}.webp`,
  )
})

test('animated, oversized pixel count, non-image, empty and >4MB inputs are rejected as input errors', async () => {
  const frame = (color) => solid(10, 10, color).png().toBuffer()
  const frames = [await frame('red'), await frame('blue')]
  const inputs = [
    await sharp(frames, { join: { animated: true } }).webp().toBuffer(),
    await sharp(frames, { join: { animated: true } }).gif().toBuffer(),
    await solid(5001, 5000).png({ compressionLevel: 9 }).toBuffer(),
    Buffer.from('not an image'),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>'),
    Buffer.alloc(0),
    Buffer.alloc(marketImages.MARKET_IMAGE_MAX_INPUT_BYTES + 1),
  ]
  for (const input of inputs) {
    await assert.rejects(() => normalizeMarketImage(input), MarketImageInputError)
  }
})

test('storage path builder accepts only lowercase sha256 hex', () => {
  assert.equal(marketImages.isSha256Hex('a'.repeat(64)), true)
  assert.equal(marketImages.isSha256Hex('A'.repeat(64)), false)
  assert.equal(marketImages.isSha256Hex('a'.repeat(63)), false)
  assert.throws(() => marketImages.buildMarketImageStoragePath('../x'))
})

test('pickMarketThumbnailUrl: item image, then category default image, then null; thumbnail_url ignored', () => {
  const toUrl = (path) => `https://cdn.example/${path}`
  const { pickMarketThumbnailUrl } = marketImages
  assert.equal(pickMarketThumbnailUrl({
    thumbnail_image: { storage_path: 'thumbnails/aa/item.webp' },
    category_item: { default_image: { storage_path: 'thumbnails/bb/category.webp' } },
  }, toUrl), 'https://cdn.example/thumbnails/aa/item.webp')
  assert.equal(pickMarketThumbnailUrl({
    thumbnail_image: null,
    category_item: { default_image: { storage_path: 'thumbnails/bb/category.webp' } },
  }, toUrl), 'https://cdn.example/thumbnails/bb/category.webp')
  assert.equal(pickMarketThumbnailUrl({ thumbnail_image: null, category_item: { default_image: null } }, toUrl), null)
  assert.equal(pickMarketThumbnailUrl({ category_item: null }, toUrl), null)
  assert.equal(pickMarketThumbnailUrl({ thumbnail_url: 'https://legacy.example/a.png' }, toUrl), null)
})
