import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'
import { NextResponse, load } from './helpers/market-images-harness.mjs'

// 11번 계획 7절: 자료 구매는 장바구니로만 한다. 상세 바로 구매 route 는 410 JSON 만 남고(돈·동의 기록 RPC 없음),
// 다시 담은 줄은 담기 route 같은 요청 안에서 선택으로 바뀌며, 배포 전 'purchase' 의도는 담기로 이어간다.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const purchaseRoutePath = 'src/app/api/market/items/[itemId]/purchase/route.ts'
const purchaseRoute = read(purchaseRoutePath)
const cartItemsRoute = read('src/app/api/market/cart/items/route.ts')
const batchRoute = read('src/app/api/market/purchases/batch/route.ts')
const itemActions = read('src/components/market/market-item-actions.tsx')
const CLOSED_MESSAGE = '상품 상세 바로 구매는 종료되었습니다. 장바구니에 담아 구매해 주세요. 이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.'

test('상세 바로 구매 route 는 410 과 정해진 JSON 만 돌려준다', async () => {
  const { POST } = load(purchaseRoutePath, { 'next/server': { NextResponse } })
  const response = await POST()
  assert.equal(response.status, 410)
  assert.deepEqual(await response.json(), {
    success: false,
    error: { code: 'MARKET_DIRECT_PURCHASE_CLOSED', message: CLOSED_MESSAGE },
  })
  assert.ok(CLOSED_MESSAGE.endsWith('이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.'))
})

test('상세 바로 구매 route 는 돈·동의 기록·인증 호출을 하지 않는다', () => {
  assert.doesNotMatch(purchaseRoute, /runMarketCheckout|enforcePurchaseNoticeAck|recordPurchaseNoticeAck|rpc\(|createClient|createAdminClient|getCreditBalanceSnapshot|import \{[^}]*\} from '@\//)
  assert.match(purchaseRoute, /^import \{ NextResponse \} from 'next\/server'$/m)
})

test('리스트 직접 결제(batch) 안내도 장바구니로 보낸다', () => {
  assert.match(batchRoute, /status: 410/)
  assert.match(batchRoute, /장바구니에서 구매해 주세요/)
})

test('다시 담은 줄은 담기 route 같은 요청 안에서 선택으로 바꾸고 결과를 reselected 로 나눈다', () => {
  const post = cartItemsRoute.slice(cartItemsRoute.indexOf('export async function POST'), cartItemsRoute.indexOf('export async function PATCH'))
  assert.match(post, /if \(!outcome\.data\.created\) \{[\s\S]{0,300}await setMarketCartSelection\(guard\.userId, \[cartItemId\], true\)/)
  assert.match(post, /reselected = selection\.ok && Array\.isArray\(selection\.data\.updatedIds\) && selection\.data\.updatedIds\.includes\(cartItemId\)/)
  assert.match(post, /reselected,\n/)
  assert.ok(post.indexOf('await addMarketCartItem(') < post.indexOf('await setMarketCartSelection('))
  // 상세 결과 창: 선택으로 바꾼 줄과 못 바꾼 줄을 다른 문구로 보인다
  assert.match(itemActions, /payload\.data\.reselected === false/)
  assert.match(itemActions, /이미 장바구니에 있어 결제할 자료로 선택해 두었습니다\./)
  assert.match(itemActions, /이미 장바구니에 있지만 선택하지 못했습니다\. 장바구니에서 선택해 주세요\./)
})

function loadCartItemsRoute({ add, select }) {
  const calls = []
  const route = load('src/app/api/market/cart/items/route.ts', {
    'next/server': { NextResponse },
    '@/lib/market-cart-server': {
      guardMarketCartRequest: async () => ({ userId: 'u1' }),
      marketCartErrorResponse: (failure) => NextResponse.json({ success: false, error: { code: failure.code } }, { status: failure.status }),
      addMarketCartItem: async (...args) => { calls.push(['add', ...args]); return add },
      setMarketCartSelection: async (...args) => { calls.push(['select', ...args]); return select },
      removeMarketCartItems: async () => ({ ok: true, data: {} }),
    },
  })
  return { route, calls }
}
const addRequest = () => ({ json: async () => ({ targetKind: 'subproduct', subproductId: 'aaaaaaaa-0000-4000-8000-0000000000a1' }) })

test('담기 route: 새 줄은 선택 저장을 부르지 않고 reselected null', async () => {
  const { route, calls } = loadCartItemsRoute({ add: { ok: true, data: { cartItemId: 'c1', created: true, count: 1 } } })
  const body = await (await route.POST(addRequest())).json()
  assert.deepEqual(body.data, { cartItemId: 'c1', created: true, count: 1, reselected: null })
  assert.deepEqual(calls.map((call) => call[0]), ['add'])
})

test('담기 route: 이미 있던 줄은 같은 요청에서 선택으로 바꾸고, 실패하면 reselected false(담기는 성공)', async () => {
  const ok = loadCartItemsRoute({
    add: { ok: true, data: { cartItemId: 'c1', created: false, count: 2 } },
    select: { ok: true, data: { updatedIds: ['c1'], missingIds: [] } },
  })
  const okResponse = await ok.route.POST(addRequest())
  assert.equal(okResponse.status, 200)
  assert.equal((await okResponse.json()).data.reselected, true)
  assert.deepEqual(ok.calls[1], ['select', 'u1', ['c1'], true])

  const failed = loadCartItemsRoute({
    add: { ok: true, data: { cartItemId: 'c1', created: false, count: 2 } },
    select: { ok: false, status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'x' },
  })
  const failedResponse = await failed.route.POST(addRequest())
  assert.equal(failedResponse.status, 200)
  assert.equal((await failedResponse.json()).data.reselected, false)
})

test('장바구니가 가득 차 하나도 못 담아도 결과 창(안내 + 장바구니 보기)으로 알린다', () => {
  assert.match(itemActions, /if \(limitCount > 0\) \{\s+setCartResult\(\{ kind: 'notice', message: limitMessage \}\)/)
  assert.match(itemActions, /<Link href="\/cart">장바구니 보기<\/Link>/)
})

test('상세에는 구매하기·확인창·잔액 확인 상태가 없고 담기 버튼 하나만 있다', () => {
  assert.doesNotMatch(itemActions, /구매하기|로그인 후 구매|잔액 확인 중|구매 처리 중|isCheckingBalance|MarketCheckoutConfirmDialog|openCheckout|\/purchase`/)
  assert.match(itemActions, /'장바구니 담기'/)
  assert.match(itemActions, /'로그인 후 담기'/)
})

test('배포 전 purchase 의도는 담기로 이어가고 새 의도는 cart 로만 저장한다', async () => {
  const { MARKET_CART_INTENT_KEY, saveMarketCartIntent, takeMarketCartIntent } = await import('../src/lib/market-cart-intent.ts')
  const map = new Map()
  const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }
  const target = { targetKind: 'subproduct', targetId: 'aaaaaaaa-0000-4000-8000-0000000000a1' }
  const now = 1_800_000_000_000
  map.set(MARKET_CART_INTENT_KEY, JSON.stringify({ action: 'purchase', itemId: 'i', workspaceSubject: 'korean', targets: [target], createdAt: now }))
  assert.equal(takeMarketCartIntent({ itemId: 'i', workspaceSubject: 'korean' }, { storage, now: now + 60_000 })?.action, 'cart')
  saveMarketCartIntent({ action: 'purchase', itemId: 'i', workspaceSubject: 'korean', targets: [target] }, { storage, now })
  assert.equal(JSON.parse(map.get(MARKET_CART_INTENT_KEY)).action, 'cart')
})
