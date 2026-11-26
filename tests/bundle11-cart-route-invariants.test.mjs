import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 11번(계획 docs/plan-bundle11-checkout-simplify.md 7절 '바뀌는 시험'): 상세 바로 구매가 닫히면서(410) 상세·구매 route 시험에서 뺀
// 단언 가운데 장바구니에도 해당하는 것을 여기로 옮겼다. 장바구니 route 불변식 — 동의 확인이 차감보다 앞, V2 kill switch,
// 동의 기록이 결제 RPC 바로 앞 — 은 꼭 남긴다. 화면 쪽 단언은 장바구니 폴더(껍데기·표시 부품)와 결제 칸 순수 함수 파일을 합쳐 본다.

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const route = read('src/app/api/market/cart/checkout/route.ts')
const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/

function walk(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}
// 장바구니 화면 = 장바구니 폴더 + 결제 칸 응답 처리(reduceCheckoutResponse)를 둔 lib 파일
const cartFiles = [
  ...walk('src/app/(solvook)/cart'),
  ...walk('src/lib').filter((path) => /reduceCheckoutResponse/.test(read(path))),
]
const cartUi = cartFiles.map(read).join('\n')

test('장바구니 결제 route: 인증 → 약관 동의 → 본문 → 구매 고지 체크 → V2 kill switch → 동의 기록 → 결제 RPC 순서', () => {
  const steps = [
    'await guardMarketCartRequest()',
    'await checkMemberConsentForApi()',
    'CheckoutBodySchema.safeParse(',
    'checkPurchaseNoticeAcknowledged(parsed.data.acknowledgePurchaseNotice)',
    'isMarketV2PurchaseEnabled()',
    'await enforcePurchaseNoticeAck({',
    'await runMarketCheckout({',
  ]
  const at = steps.map((step) => route.indexOf(step))
  at.forEach((index, i) => assert.ok(index > 0, `${steps[i]} 있음`))
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], `${steps[i - 1]} → ${steps[i]}`)
  assert.equal(route.split('await runMarketCheckout({').length, 2, '결제 RPC 는 한 곳')
  assert.match(route, /V2_PURCHASE_DISABLED/)
})

test('장바구니 결제 route: 동의 기록이 결제 RPC 바로 앞(사이에 다른 await 없음), 실패면 결제하지 않는다', () => {
  const from = route.indexOf('await enforcePurchaseNoticeAck({')
  const to = route.indexOf('await runMarketCheckout({')
  const between = route.slice(from + 'await enforcePurchaseNoticeAck({'.length, to)
  assert.doesNotMatch(between, /\bawait\b/)
  assert.match(between, /if \(noticeFailure\) \{\s+return marketCartErrorResponse\(noticeFailure\)/)
})

test('장바구니 결제 route: strict 본문, cart 모드, 부분 보유 확인·멱등 키를 그대로 넘기고 잔액은 스냅숏 필드로 돌려준다', () => {
  assert.match(route, /\}\)\.strict\(\)\)\.min\(1\)\.max\(50\),\n  idempotencyKey: z\.string\(\)\.uuid\(\),/)
  assert.match(route, /acknowledgePurchaseNotice: z\.boolean\(/)
  assert.match(route, /noticeSha256: z\.string\([^\n]*\.regex\(\/\^\[0-9a-f\]\{64\}\$\//)
  assert.match(route, /mode: 'cart'/)
  assert.match(route, /acknowledgeNoDiscount: line\.acknowledgeNoDiscount \?\? false/)
  assert.match(route, /idempotencyKey: parsed\.data\.idempotencyKey/)
  assert.match(route, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
  assert.doesNotMatch(route, /mode: 'direct'/)
})

test('장바구니 화면: 결제 응답(402·가격 변경·부분 보유 확인·고지 변경·5xx 재시도)을 처리하고 완료 창을 그린다', () => {
  assert.ok(cartFiles.length > 0)
  for (const code of ['PRICE_CHANGED', 'ACK_REQUIRED', 'PURCHASE_NOTICE_CHANGED']) {
    assert.match(cartUi, new RegExp(`'${code}'`), code)
  }
  assert.match(cartUi, /402/)
  assert.match(cartUi, /retryable/)
  // 409 재확인 등은 새 키, 재시도(5xx·네트워크)는 같은 키
  assert.match(cartUi, /crypto\.randomUUID\(\)/)
  assert.match(cartUi, /\/api\/market\/cart\/checkout/)
  assert.match(cartUi, /<MarketPurchaseCompleteDialog/)
  assert.doesNotMatch(cartUi, /\/api\/market\/items\/\$\{[^}]+\}\/purchase/)
})

test('장바구니 화면에는 raw hex 색이 없다', () => {
  for (const path of cartFiles) assert.doesNotMatch(read(path), RAW_HEX, path)
})
