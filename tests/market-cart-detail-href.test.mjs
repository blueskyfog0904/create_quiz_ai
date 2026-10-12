import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse, createFakeAdmin, load, op } from './helpers/market-images-harness.mjs'

const ITEM_KO = '00000000-0000-4000-8000-0000000000a1'
const ITEM_EN = '00000000-0000-4000-8000-0000000000a2'
const HIDDEN_BOARD = '00000000-0000-4000-8000-0000000000b1'

const cart = load('src/lib/market-cart-server.ts', {
  'server-only': {},
  'next/server': { NextResponse },
  '@/lib/credit-balance': {},
  '@/lib/market-checkout-server': {},
  '@/lib/supabase/server': {},
  '@/lib/supabase/bypass': {},
})

// 게시판이 숨김(is_visible=false)이어도 상세 링크는 상품 상태만으로 정한다.
function fakeDb() {
  return createFakeAdmin(({ table }) => {
    if (table === 'market_items') {
      return {
        data: [
          { id: ITEM_KO, workspace_subject: 'korean', menu_entry_id: HIDDEN_BOARD },
          { id: ITEM_EN, workspace_subject: 'english', menu_entry_id: null },
        ],
        error: null,
      }
    }
    if (table === 'market_menu_entries') {
      return { data: [{ id: HIDDEN_BOARD, slug: 'entexam', workspace_subject: 'korean', is_visible: false }], error: null }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

test('장바구니 상세 링크는 공개·활성·미삭제 상품에 /items/{id}?subject= 로 만든다', async () => {
  const db = fakeDb()
  const hrefs = await cart.getMarketCartDetailHrefs(db.client, [ITEM_KO, ITEM_EN])

  assert.deepEqual(Object.fromEntries(hrefs), {
    [ITEM_KO]: `/items/${ITEM_KO}?subject=korean`,
    [ITEM_EN]: `/items/${ITEM_EN}?subject=english`,
  })
  assert.equal(db.calls.length, 1)
  const [{ table, ops }] = db.calls
  assert.equal(table, 'market_items')
  assert.deepEqual(op(ops, 'in'), ['in', 'id', [ITEM_KO, ITEM_EN]])
  assert.deepEqual(op(ops, 'eq'), ['eq', 'status', 'published'])
  assert.ok(ops.some(([name, column, value]) => name === 'eq' && column === 'is_active' && value === true))
  assert.deepEqual(op(ops, 'is'), ['is', 'deleted_at', null])
})

test('장바구니 상세 링크는 게시판(market_menu_entries)을 조회하지 않는다', async () => {
  const db = fakeDb()
  await cart.getMarketCartDetailHrefs(db.client, [ITEM_KO])
  assert.equal(db.calls.some((call) => call.table === 'market_menu_entries'), false)
})

test('빈 목록은 조회 없이 빈 결과, 조회 실패는 링크 없이 돌려준다', async () => {
  const empty = fakeDb()
  assert.equal((await cart.getMarketCartDetailHrefs(empty.client, [])).size, 0)
  assert.equal(empty.calls.length, 0)

  const failing = createFakeAdmin(() => ({ data: null, error: { code: '500' } }))
  const errors = []
  const withErrors = load('src/lib/market-cart-server.ts', {
    'server-only': {},
    'next/server': { NextResponse },
    '@/lib/credit-balance': {},
    '@/lib/market-checkout-server': {},
    '@/lib/supabase/server': {},
    '@/lib/supabase/bypass': {},
  }, errors)
  assert.equal((await withErrors.getMarketCartDetailHrefs(failing.client, [ITEM_KO])).size, 0)
  assert.equal(errors.length, 1)
})
