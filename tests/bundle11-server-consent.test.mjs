import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load } from './helpers/market-images-harness.mjs'

// 11번 계획 11-1 '서버'·'개발 전용 스위치'(자료 쪽 + 전체 소스 계약). 충전 쪽 실행 시험은 bundle11-charge-checkout.test.mjs.
const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const examples = JSON.parse(read('tests/fixtures/bundle11-consent-examples.json'))
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

const pointPolicyLib = load('src/lib/point-charge-policy.ts', { '@/lib/payment-constants': { MAX_POINT_CHARGE_AMOUNT: 100000 } })
const consentLib = load('src/lib/checkout-consent.ts', { '@/lib/point-charge-policy': pointPolicyLib })
const marketPolicyLib = load('src/lib/market-purchase-policy.ts')

function fakeAdmin({ settings = {}, rpc = () => ({ data: null, error: null }) } = {}) {
  const calls = []
  const client = {
    from: () => {
      const query = { key: null }
      query.select = () => query
      query.eq = (column, value) => { if (column === 'key') query.key = value; return query }
      query.maybeSingle = async () => ({ data: settings[query.key] === undefined ? null : { value: settings[query.key] }, error: null })
      return query
    },
    rpc: async (name, params) => { calls.push({ name, params }); return rpc(name, params) },
  }
  return { calls, client }
}

function loadMarketServer({ admin, preview = false }) {
  const bypass = { createAdminClient: () => admin.client }
  const consentServer = load('src/lib/checkout-consent-server.ts', {
    'server-only': {},
    '@/lib/supabase/bypass': bypass,
    '@/lib/footer-content': { SITE_FOOTER_CONTENT_SETTING_KEY: 'site_footer_content' },
    '@/lib/checkout-consent': consentLib,
  })
  return load('src/lib/market-purchase-policy-server.ts', {
    'server-only': {},
    'next/cache': { revalidateTag: () => {}, unstable_cache: (fn) => fn },
    '@/lib/supabase/bypass': bypass,
    '@/lib/market-purchase-policy': marketPolicyLib,
    '@/lib/checkout-consent': consentLib,
    '@/lib/checkout-consent-server': consentServer,
    '@/lib/checkout-consent-preview': { isCheckoutConsentPreview: () => preview },
  })
}

const visibleFooter = {
  policyDocuments: {
    refundPolicy: { label: '취소/환불정책', content: '본문', enabled: true, slug: 'refund', title: '취소/환불정책' },
    serviceTerms: { label: '서비스 이용약관', content: '본문', enabled: true, slug: 'service', title: '이용약관' },
  },
}
const v1Policy = {
  version: 1, refundDays: 30,
  ...Object.fromEntries(marketPolicyLib.MARKET_PURCHASE_POLICY_TEXT_KEYS.map((key) => [key, key === 'checkboxLabel' ? '{자료환불기간}일 확인' : `${key} 본문`])),
}
const withV2 = { ...v1Policy, ...examples.bases.market, ...examples.cartCases[1].value }
const ARGS = { userId: 'u', idempotencyKey: 'k', noticeSha256: 'a'.repeat(64), cartTextsSha256: 'b'.repeat(64) }

test('스위치 참: 자료 기록 감싸개는 RPC 를 부르기 전에 unavailable → 503(동의 기록·결제 RPC 0회)', async () => {
  const admin = fakeAdmin()
  const server = loadMarketServer({ admin, preview: true })
  assert.deepEqual(await server.recordPurchaseNoticeAck(ARGS), { status: 'unavailable' })
  const failure = await server.enforcePurchaseNoticeAck(ARGS)
  assert.equal(failure.status, 503)
  assert.equal(failure.code, 'PURCHASE_NOTICE_UNAVAILABLE')
  assert.equal(admin.calls.length, 0)
})

test('11번 함수 표식: 응답에 consentFormat 키가 없으면 503, 값이 null 이어도 11번 응답(입력 오류 400)', async () => {
  for (const [data, status] of [[{ ok: true }, 503], [{ ok: true, replay: false, consentFormat: 1 }, null],
    [{ ok: false, code: 'NOTICE_INPUT_INVALID', consentFormat: null }, 400], [{ ok: false, code: 'NOTICE_POLICY_UNAVAILABLE', consentFormat: 2 }, 503]]) {
    const admin = fakeAdmin({ rpc: () => ({ data, error: null }) })
    const failure = await loadMarketServer({ admin }).enforcePurchaseNoticeAck(ARGS)
    assert.equal(failure?.status ?? null, status, JSON.stringify(data))
    assert.deepEqual(admin.calls[0].params, { p_user_id: 'u', p_idempotency_key: 'k', p_notice_sha256: 'a'.repeat(64), p_cart_texts_sha256: 'b'.repeat(64) })
  }
})

test('409: 2판 묶음은 2판 묶음으로, 1판 고지는 consentFormat 1 을 붙여, 장바구니 문구는 최상위 cartTexts 로(새 해석기를 지난 값만)', async () => {
  const draft = consentLib.buildCheckoutConsentDraft('market', examples.bases.market, 30)
  const bundle = { ...draft, noticeSha256: sha(consentLib.buildCheckoutConsentText(draft)) }
  const cartTexts = { ...examples.cartCases[1].value, cartTextsSha256: examples.cartCases[1].cartTextsSha256 }
  let admin = fakeAdmin({ rpc: () => ({ data: { ok: false, code: 'NOTICE_CHANGED', details: bundle, cartTexts, consentFormat: 2 }, error: null }) })
  let failure = await loadMarketServer({ admin }).enforcePurchaseNoticeAck(ARGS)
  assert.equal(failure.status, 409)
  assert.equal(failure.code, 'PURCHASE_NOTICE_CHANGED')
  assert.deepEqual(failure.details, bundle)
  assert.deepEqual(failure.cartTexts, cartTexts)
  const v1 = { checkboxLabel: '라벨', confirmNotice: '본문', noticeSha256: 'c'.repeat(64), refundDays: 30, consentFormat: 1 }
  admin = fakeAdmin({ rpc: () => ({ data: { ok: false, code: 'NOTICE_KEY_CONFLICT', details: v1, cartTexts: { cartCheckoutNotice: '{깨짐}' }, consentFormat: 1 }, error: null }) })
  failure = await loadMarketServer({ admin }).enforcePurchaseNoticeAck(ARGS)
  assert.deepEqual(failure.details, v1)
  assert.equal(failure.cartTexts, null)
  admin = fakeAdmin({ rpc: () => ({ data: { ok: false, code: 'NOTICE_CHANGED', details: { consentFormat: 2, consentTitle: 'x' }, consentFormat: 2 }, error: null }) })
  failure = await loadMarketServer({ admin }).enforcePurchaseNoticeAck(ARGS)
  assert.equal(failure.details, undefined)
})

test('장바구니 화면 읽기: 판 1 이면 1판 고지만, 판 2 면 2판 묶음만, 판 값이 틀리면 둘 다 없음(경보는 DB 판이 2 일 때만)', async () => {
  let admin = fakeAdmin({ settings: { market_purchase_policy: { ...withV2, consentFormat: 1 }, site_footer_content: visibleFooter } })
  let read1 = await loadMarketServer({ admin }).readMarketPurchaseConsentUncached()
  assert.equal(read1.consentFormat, 1)
  assert.ok(read1.notice && read1.consent === null)
  assert.equal(read1.cartTexts.cartTextsSha256, examples.cartCases[1].cartTextsSha256)
  admin = fakeAdmin({ settings: { market_purchase_policy: { ...withV2, consentFormat: 2 }, site_footer_content: visibleFooter } })
  read1 = await loadMarketServer({ admin }).readMarketPurchaseConsentUncached()
  assert.equal(read1.notice, null)
  assert.equal(read1.consent.noticeSha256, sha(consentLib.buildCheckoutConsentText(read1.consent)))
  assert.equal(read1.preview, null)
  for (const format of ['2', 3, null]) {
    admin = fakeAdmin({ settings: { market_purchase_policy: { ...withV2, consentFormat: format }, site_footer_content: visibleFooter } })
    read1 = await loadMarketServer({ admin }).readMarketPurchaseConsentUncached()
    assert.equal(read1.consentFormat, null)
    assert.equal(read1.notice, null)
    assert.equal(read1.consent, null)
    // 판 값 오류는 결제가 닫히므로 경보 1회(구현 검증 반영)
    assert.deepEqual(admin.calls.map((call) => [call.name, call.params.p_details.reason]), [['record_payment_alert', 'consent_format_invalid']])
    const previewAdmin = fakeAdmin({ settings: { market_purchase_policy: { ...withV2, consentFormat: format }, site_footer_content: visibleFooter } })
    await loadMarketServer({ admin: previewAdmin, preview: true }).readMarketPurchaseConsentUncached()
    assert.equal(previewAdmin.calls.length, 0, '스위치 참이면 경보 없음')
  }
  // DB 판 2 인데 링크 문서가 꺼짐 → 묶음 없음 + 경보 1회
  admin = fakeAdmin({ settings: { market_purchase_policy: { ...withV2, consentFormat: 2 },
    site_footer_content: { policyDocuments: { ...visibleFooter.policyDocuments, serviceTerms: { ...visibleFooter.policyDocuments.serviceTerms, enabled: false } } } } })
  read1 = await loadMarketServer({ admin }).readMarketPurchaseConsentUncached()
  assert.equal(read1.consent, null)
  assert.deepEqual(admin.calls.map((call) => call.name), ['record_payment_alert'])
  // 1판 해석 실패만 throw
  admin = fakeAdmin({ settings: { market_purchase_policy: { ...withV2, refundDays: 0 } } })
  await assert.rejects(loadMarketServer({ admin }).readMarketPurchaseConsentUncached())
})

test('스위치 참: 화면용 값은 판 2 로 그리고, 2판 키가 없거나 깨져도 경보 RPC 0회·고지 없음(띠에 키 없음)', async () => {
  for (const policy of [v1Policy, { ...withV2, consentTitle: '30일 동의' }]) {
    const admin = fakeAdmin({ settings: { market_purchase_policy: policy, site_footer_content: visibleFooter } })
    const result = await loadMarketServer({ admin, preview: true }).readMarketPurchaseConsentUncached()
    assert.equal(result.consentFormat, 2)
    assert.equal(result.notice, null)
    assert.equal(result.consent, null)
    assert.deepEqual(result.preview, { keysMissing: true })
    assert.equal(admin.calls.length, 0)
  }
  const admin = fakeAdmin({ settings: { market_purchase_policy: withV2, site_footer_content: visibleFooter } })
  const result = await loadMarketServer({ admin, preview: true }).readMarketPurchaseConsentUncached()
  assert.ok(result.consent)
  assert.deepEqual(result.preview, { keysMissing: false })
})

function walk(dir, found = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, found)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) found.push(path)
  }
  return found
}

test('개발 스위치 소스 계약: 환경 변수 이름은 한 파일, 부르는 곳은 읽는 함수와 두 기록 감싸개뿐(둘 다 맨 앞), route·미들웨어·껍데기에는 없음', () => {
  const sources = walk('src').map((path) => [path, read(path)])
  assert.deepEqual(sources.filter(([, s]) => s.includes('CHECKOUT_CONSENT_PREVIEW')).map(([p]) => p), ['src/lib/checkout-consent-preview.ts'])
  const callers = sources.filter(([p, s]) => p !== 'src/lib/checkout-consent-preview.ts' && s.includes('isCheckoutConsentPreview(')).map(([p]) => p).sort()
  assert.deepEqual(callers, ['src/lib/market-purchase-policy-server.ts', 'src/lib/point-charge-policy-server.ts'])
  for (const [path, wrapper, reader] of [
    ['src/lib/market-purchase-policy-server.ts', 'export async function recordPurchaseNoticeAck(', 'export async function readMarketPurchaseConsentUncached('],
    ['src/lib/point-charge-policy-server.ts', 'export async function recordPointChargeCheckoutAck(', 'export async function readPointChargeConsentUncached('],
  ]) {
    const source = read(path)
    const body = source.slice(source.indexOf('{', source.indexOf('): Promise<', source.indexOf(wrapper))) + 1)
    const firstStatement = body.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('//'))
    assert.equal(firstStatement, "if (isCheckoutConsentPreview()) return { status: 'unavailable' }", path)
    const readerBody = source.slice(source.indexOf(reader), source.indexOf('\n}\n', source.indexOf(reader)))
    assert.match(readerBody, /const preview = isCheckoutConsentPreview\(\)/, path)
    assert.equal((source.match(/isCheckoutConsentPreview\(\)/g) ?? []).length >= 2, true, path)
  }
  const nextConfig = readdirSync(ROOT).filter((name) => /^next\.config\./.test(name)).map((name) => read(name)).join('\n')
  assert.doesNotMatch(nextConfig, /allowDevelopmentBuild/)
})

test('개발 스위치 조건 셋: 개발 모드·VERCEL 없음·값 정확히 "2"', async () => {
  const { isCheckoutConsentPreview } = load('src/lib/checkout-consent-preview.ts')
  const saved = { NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, CHECKOUT_CONSENT_PREVIEW: process.env.CHECKOUT_CONSENT_PREVIEW }
  try {
    const set = (env) => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
    set({ NODE_ENV: 'development', VERCEL: undefined, CHECKOUT_CONSENT_PREVIEW: '2' })
    assert.equal(isCheckoutConsentPreview(), true)
    for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { CHECKOUT_CONSENT_PREVIEW: '1' }, { CHECKOUT_CONSENT_PREVIEW: ' 2' }, { CHECKOUT_CONSENT_PREVIEW: undefined }]) {
      set({ NODE_ENV: 'development', VERCEL: undefined, CHECKOUT_CONSENT_PREVIEW: '2', ...env })
      assert.equal(isCheckoutConsentPreview(), false, JSON.stringify(env))
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

test('캐시 키 v3·v2, 장바구니 뷰·충전 화면은 캐시 없이 읽음, 상세·보관함은 60초 캐시 그대로', () => {
  const market = read('src/lib/market-purchase-policy-server.ts')
  const point = read('src/lib/point-charge-policy-server.ts')
  assert.match(market, /\[`\$\{MARKET_PURCHASE_POLICY_SETTING_KEY\}:v3`\]/)
  assert.match(point, /\[`\$\{POINT_CHARGE_POLICY_SETTING_KEY\}:v2`\]/)
  const cart = read('src/lib/market-cart-server.ts')
  assert.match(cart, /readMarketPurchaseConsentUncached\(\)/)
  assert.doesNotMatch(cart, /getMarketPurchasePolicyView/)
  assert.match(read('src/app/(solvook)/items/[itemId]/page.tsx'), /getMarketPurchasePolicyView\(\)/)
  // 장바구니 뷰는 판마다 칸을 나눈다(둘 중 하나만 값)
  assert.match(cart, /purchaseNotice: consentRead\?\.consentFormat === 1 \? consentRead\.notice : null,/)
  assert.match(cart, /purchaseConsent: consentRead\?\.consentFormat === 2 \? consentRead\.consent : null,/)
  // 1판 해석기(환불·보관함·상세가 씀)는 새 키를 읽지 않는다
  for (const source of [read('src/lib/market-purchase-policy.ts'), read('src/lib/point-charge-policy.ts')]) {
    const parse = source.slice(source.indexOf('export function parse'), source.indexOf('\n}\n', source.indexOf('export function parse')))
    assert.doesNotMatch(parse, /consentFormat|consentTitle|consentItems|cartCheckoutNotice/)
  }
})

test('장바구니 결제 route: cartTextsSha256 없으면 영수증 먼저(있으면 성공 모양, 조회 실패 503, 없으면 400) — 동의 기록 전', () => {
  const route = read('src/app/api/market/cart/checkout/route.ts')
  const receiptAt = route.indexOf('await getMarketCheckoutReceipt(guard.userId, parsed.data.idempotencyKey)')
  assert.ok(route.indexOf('isMarketV2PurchaseEnabled()') < receiptAt && receiptAt < route.indexOf('await enforcePurchaseNoticeAck({'))
  const block = route.slice(receiptAt - 400, route.indexOf('await enforcePurchaseNoticeAck({'))
  assert.match(block, /status: 503,\n\s+code: 'RECEIPT_LOOKUP_FAILED'/)
  assert.match(block, /alreadyCompleted: true,\n\s+\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
  assert.match(block, /status: 400,\n\s+code: 'CART_TEXTS_REQUIRED'/)
  assert.match(route, /cartTextsSha256: z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{64\}\$\/, [^)]+\)\.optional\(\)/)
  // 409 의 최상위 cartTexts 자리(5-2)
  assert.match(read('src/lib/market-cart-server.ts'), /\.\.\.\(failure\.cartTexts !== undefined \? \{ cartTexts: failure\.cartTexts \} : \{\}\)/)
})

test('배치 상수: 장바구니 결제 칸 열 폭 = 관리자 미리보기 폭(같은 상수), 판정 함수 경계값', () => {
  const layout = load('src/lib/checkout-panel-layout.ts')
  assert.ok(read('src/app/(solvook)/cart/_components/cart-page-view.tsx').includes(`lg:grid-cols-[minmax(0,1fr)_${layout.CHECKOUT_PANEL_WIDTH}px]`))
  assert.match(read('src/components/admin/checkout-consent-admin-preview.tsx'), /CART_PANEL_PREVIEW_CONTENT_WIDTH = CHECKOUT_PANEL_CONTENT_WIDTH/)
  // 미리보기 상자(border-box, 테두리 1px·p-5)의 겉폭 = 장바구니 칸 폭 → 안쪽 358px 이 같다
  assert.equal((read('src/components/admin/checkout-consent-admin-preview.tsx').match(/style=\{\{ width: CHECKOUT_PANEL_WIDTH \}\}/g) ?? []).length, 2)
  assert.equal(layout.CHECKOUT_PANEL_CONTENT_WIDTH, layout.CHECKOUT_PANEL_WIDTH - 42)
  const top = layout.CHECKOUT_PANEL_TOP_MIN_HEIGHT
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: 300, maxInnerHeight: 300 + top }), 'sticky')
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: 301, maxInnerHeight: 300 + top }), 'flow')
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: 0, maxInnerHeight: 500 }), 'flow')
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: Number.NaN, maxInnerHeight: 500 }), 'flow')
})

test('기록 경로: DB 가 판 2 에서 닫으면(NOTICE_POLICY_UNAVAILABLE + consentFormat 2) 경보 1회, 판 1·null 이면 없음', async () => {
  for (const [consentFormat, alerts] of [[2, 1], [1, 0], [null, 0]]) {
    const admin = fakeAdmin({ rpc: (name) => (name === 'record_purchase_notice_ack'
      ? { data: { ok: false, code: 'NOTICE_POLICY_UNAVAILABLE', consentFormat }, error: null } : { data: true, error: null }) })
    const failure = await loadMarketServer({ admin }).enforcePurchaseNoticeAck(ARGS)
    assert.equal(failure.status, 503)
    assert.equal(admin.calls.filter((call) => call.name === 'record_payment_alert').length, alerts, String(consentFormat))
  }
})

test('충전도 같은 경보: 기록 경로 판 2 닫힘·판 값 오류(스위치 꺼짐일 때만)', () => {
  const point = read('src/lib/point-charge-policy-server.ts')
  assert.match(point, /if \(result\.code === 'NOTICE_POLICY_UNAVAILABLE' && result\.consentFormat === 2\) \{\n\s+await recordCheckoutConsentUnavailableAlert\('point_charge', \{ screen: 'record' \}\)/)
  assert.match(point, /if \(!preview && storedFormat === null\) \{\n\s+await recordCheckoutConsentUnavailableAlert\('point_charge', \{ screen, reason: 'consent_format_invalid' \}\)/)
})
