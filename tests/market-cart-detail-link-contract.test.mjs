import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/cart-detail-multiselect-plan.md 12절 D13·D14: 장바구니 행 상품명 → 상세 링크
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const cartServer = read('../src/lib/market-cart-server.ts')
const cartView = read('../src/app/(solvook)/cart/_components/cart-view.tsx')

test('cart items expose a server-built detail href', () => {
  assert.match(cartServer, /detailHref: string \| null/)
  assert.match(cartServer, /detailHref: target\.itemId \? detailHrefs\.get\(target\.itemId\) \?\? null : null/)
})

test('detail href follows the detail page visibility rules without hardcoded slugs', () => {
  const helper = cartServer.slice(
    cartServer.indexOf('async function getMarketCartDetailHrefs'),
    cartServer.indexOf('export async function getMarketCartView')
  )
  assert.match(helper, /\.from\('market_items'\)\s+\.select\('id, workspace_subject'\)\s+\.in\('id', itemIds\)\s+\.eq\('status', 'published'\)\s+\.eq\('is_active', true\)\s+\.is\('deleted_at', null\)/)
  // 상세 주소가 게시판과 무관해져 게시판 조회가 없다
  assert.doesNotMatch(helper, /market_menu_entries/)
  assert.match(helper, /`\/items\/\$\{item\.id\}\?subject=\$\{item\.workspace_subject\}`/)
  assert.doesNotMatch(helper, /boards\//)
})

test('cart view links the item title only when a detail href exists', () => {
  assert.match(cartView, /\{item\.detailHref \? \(\s+<Link\s+href=\{item\.detailHref\}/)
  assert.match(cartView, /\) : title\}/)
  assert.match(cartView, /hover:text-\[var\(--studio-primary\)\] focus-visible:ring-2 focus-visible:ring-\[var\(--studio-focus-ring\)\]/)
  assert.match(cartView, /break-keep font-bold leading-6 text-\[var\(--studio-ink\)\]/)
  assert.doesNotMatch(cartView, /after:absolute/)
})
