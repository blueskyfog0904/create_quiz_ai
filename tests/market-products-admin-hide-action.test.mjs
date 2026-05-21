import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketProductsClient = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

test('admin market products list exposes a hide action that patches item status to hidden', () => {
  assert.match(marketProductsClient, /EyeOff/, 'list action should render a hide icon')
  assert.match(marketProductsClient, /handleHideFromList/, 'list should have a dedicated hide handler')
  assert.match(marketProductsClient, /status:\s*'hidden'/, 'hide handler should set hidden status')
  assert.match(marketProductsClient, /method:\s*'PATCH'/, 'hide handler should update the existing item')
  assert.match(marketProductsClient, /aria-label=\{`\$\{item\.title\} 숨김 처리`\}/, 'hide icon should be accessible')
})
