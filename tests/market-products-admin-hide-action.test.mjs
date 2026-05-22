import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('admin market products list exposes a visibility action that patches item status', () => {
  assert.match(marketProductsClient, /Eye, EyeOff/, 'list action should render hide and unhide icons')
  assert.match(marketProductsClient, /EyeOff/, 'list action should render a hide icon')
  assert.match(marketProductsClient, /handleVisibilityFromList/, 'list should have a dedicated visibility toggle handler')
  assert.match(marketProductsClient, /status:\s*nextStatus/, 'visibility handler should set the computed next status')
  assert.match(marketProductsClient, /method:\s*'PATCH'/, 'hide handler should update the existing item')
  assert.match(marketProductsClient, /숨김 처리/, 'hide icon should be accessible')
})

test('admin market products list toggles hidden items back to published', () => {
  assert.match(marketProductsClient, /hiddenItemIds/, 'list should track locally hidden item ids')
  assert.match(
    marketProductsClient,
    /const nextStatus = isHidden \? 'published' : 'hidden'/,
    'visibility action should publish hidden rows and hide visible rows'
  )
  assert.match(marketProductsClient, /status:\s*nextStatus/, 'visibility handler should patch the computed next status')
  assert.match(marketProductsClient, /setHiddenOverride\(item\.id,\s*nextStatus === 'hidden'\)/, 'local hidden override should follow the computed next status')
  assert.match(
    marketProductsClient,
    /const isHidden = item\.status === 'hidden' \|\| hiddenItemIds\.includes\(item\.id\)/,
    'row display state should include the local hidden override'
  )
  assert.match(
    marketProductsClient,
    /aria-label=\{isHidden \? `\$\{item\.title\} 숨김 해제` : `\$\{item\.title\} 숨김 처리`\}/,
    'hidden rows should expose an unhide action'
  )
  assert.match(marketProductsClient, /disabled=\{hidingItemId === item\.id\}/, 'hidden rows should not disable the visibility button')
  assert.doesNotMatch(marketProductsClient, /disabled=\{hidingItemId === item\.id \|\| isHidden\}/, 'hidden rows should remain clickable for unhide')
})
