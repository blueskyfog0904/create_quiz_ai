import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin } from './helpers/market-images-harness.mjs'

// 11번 묶음(docs/plan-bundle11-checkout-simplify.md) 8절·10-1·11-1: 충전 결제 화면의 2판(접는 동의)과 개발 전용 스위치(충전 쪽).
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const checkoutClient = read('src/app/checkout/checkout-client.tsx')
const checkoutPage = read('src/app/checkout/page.tsx')
const ordersRoute = read('src/app/api/payments/payapp/orders/route.ts')
const seedPolicy = JSON.parse(read('supabase/migrations/20261125100000_point_charge_policy.sql').split('$json$')[1])

const policyLib = load('src/lib/point-charge-policy.ts', { '@/lib/payment-constants': { MAX_POINT_CHARGE_AMOUNT: 100000 } })
const consentLib = load('src/lib/checkout-consent.ts', { '@/lib/point-charge-policy': policyLib })

// 충전 서버 모듈을 가짜 DB·스위치로 불러온다. calls 에 RPC·조회가 쌓이고, alerts 에 2판 경보 호출이 쌓인다.
function loadServer({ preview = false, policyValue = seedPolicy, rpcResult = null, bundle = null, previewKeys = null } = {}) {
  const alerts = []
  const fake = createFakeAdmin(({ table }) => (table === 'system_settings'
    ? { data: policyValue === undefined ? null : { value: policyValue }, error: null }
    : { data: null, error: null }), { rpc: () => ({ data: rpcResult, error: null }) })
  const server = load('src/lib/point-charge-policy-server.ts', {
    'server-only': {},
    'next/cache': { revalidateTag: () => {}, unstable_cache: (fn) => fn },
    '@/lib/supabase/bypass': { createAdminClient: () => fake.client },
    '@/lib/point-charge-policy': policyLib,
    '@/lib/checkout-consent': consentLib,
    '@/lib/checkout-consent-server': {
      buildCheckoutConsentBundle: () => bundle,
      buildCheckoutConsentBundleIgnoringLinks: () => bundle,
      readRawSiteFooterValue: async () => ({}),
      recordCheckoutConsentUnavailableAlert: async (kind, details) => { alerts.push({ kind, details }) },
    },
    '@/lib/checkout-consent-preview': { isCheckoutConsentPreview: () => preview, readCheckoutConsentPreviewKeys: async (kind) => previewKeys?.[kind] ?? null },
  })
  return { server, calls: fake.calls, alerts }
}

const ACK_INPUT = {
  userId: '00000000-0000-4000-8000-000000000001',
  checkoutAttemptId: '00000000-0000-4000-8000-000000000002',
  planId: '00000000-0000-4000-8000-000000000003',
  expectedAmount: 10000,
  expectedCredits: 100,
  noticeSha256: 'a'.repeat(64),
}

test('스위치가 켜지면 충전 동의 기록 감싸개는 RPC 전에 unavailable(기록·주문 준비 없음)', async () => {
  const { server, calls } = loadServer({ preview: true, rpcResult: { ok: true, consentFormat: 1 } })
  assert.deepEqual(await server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'unavailable' })
  assert.equal(calls.filter((call) => call.type === 'rpc').length, 0)
  // 감싸개 맨 앞에서 판정한다.
  const wrapper = read('src/lib/point-charge-policy-server.ts')
  const body = wrapper.slice(wrapper.indexOf('export async function recordPointChargeCheckoutAck('))
  assert.match(body, /^export async function recordPointChargeCheckoutAck\([\s\S]*?\): Promise<RecordCheckoutAckResult> \{\s*\/\/[^\n]*\n\s*if \(isCheckoutConsentPreview\(\)\) return \{ status: 'unavailable' \}/)
})

test('11번 함수 표식: 응답에 consentFormat 키가 없으면 닫고(503), 값이 null 이어도 11번 응답으로 본다', async () => {
  assert.deepEqual(await loadServer({ rpcResult: { ok: true, replay: false } }).server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'unavailable' })
  assert.deepEqual(await loadServer({ rpcResult: { ok: true, replay: false, consentFormat: 1 } }).server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'ok' })
  assert.deepEqual(await loadServer({ rpcResult: { ok: false, code: 'MEMBER_WITHDRAWN', consentFormat: null } }).server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'member_withdrawn' })
  assert.deepEqual(await loadServer({ rpcResult: { ok: false, code: 'NOTICE_INPUT_INVALID', consentFormat: null } }).server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'invalid' })
})

test('409 고지: 2판 묶음이면 2판으로, 1판 고지면 1판으로 해석한다(새 해석기만 통과)', async () => {
  const v2 = { consentFormat: 2, consentTitle: '제목', consentSummary: ['요약'], consentItems: [{ key: 'terms', label: '약관', view: 'link', link: 'serviceTerms' }],
    noticeSha256: 'b'.repeat(64), refundDays: 7, plan: { price: 10000, credits: 100 } }
  const changed = await loadServer({ rpcResult: { ok: false, code: 'NOTICE_CHANGED', consentFormat: 2, details: v2 } }).server.recordPointChargeCheckoutAck(ACK_INPUT)
  assert.equal(changed.status, 'notice_changed')
  assert.equal(changed.notice.consentFormat, 2)
  assert.equal(Object.hasOwn(changed.notice, 'plan'), false)
  const v1 = { ...policyLib.fillPointChargeCheckoutNotice(policyLib.parsePointChargePolicy(seedPolicy)), noticeSha256: 'c'.repeat(64), consentFormat: 1, plan: { price: 1, credits: 2 } }
  const planChanged = await loadServer({ rpcResult: { ok: false, code: 'PLAN_CHANGED', consentFormat: 1, details: v1 } }).server.recordPointChargeCheckoutAck(ACK_INPUT)
  assert.equal(planChanged.status, 'plan_changed')
  assert.equal(planChanged.notice.checkoutTitle, v1.checkoutTitle)
  assert.deepEqual(planChanged.plan, { price: 1, credits: 2 })
})

test('스위치 참 + 2판 키 없음(묶음 못 만듦) → 고지 없음, 경보 0회', async () => {
  const { server, alerts, calls } = loadServer({ preview: true, bundle: null })
  const screen = await server.getPointChargeCheckoutNotice('u1')
  assert.deepEqual(screen, { checkoutNotice: null, checkoutConsent: null, preview: { keysMissing: true } })
  assert.equal(alerts.length, 0)
  assert.equal(calls.filter((call) => call.type === 'rpc').length, 0)
})

test('DB 판이 2 인데 2판이 깨지면 경보 1회, 판 1 이면 2판 경보 없음', async () => {
  const stored2 = loadServer({ policyValue: { ...seedPolicy, consentFormat: 2 }, bundle: null })
  const screen2 = await stored2.server.getPointChargeCheckoutNotice('u1')
  assert.equal(screen2.checkoutConsent, null)
  assert.equal(screen2.checkoutNotice, null)
  assert.equal(stored2.alerts.length, 1)
  const stored1 = loadServer({ policyValue: seedPolicy })
  const screen1 = await stored1.server.getPointChargeCheckoutNotice('u1')
  assert.equal(screen1.checkoutConsent, null)
  assert.equal(typeof screen1.checkoutNotice.noticeSha256, 'string')
  assert.equal(stored1.alerts.length, 0)
})

test('판 1 + 1판 정책 읽기 실패 → 기존 경보(record_payment_alert) 1회, 스위치와 관계없이', async () => {
  for (const preview of [false, true]) {
    const { server, calls, alerts } = loadServer({ preview, policyValue: { broken: true } })
    const screen = await server.getPointChargeCheckoutNotice('u1')
    assert.equal(screen.checkoutNotice, null)
    assert.equal(screen.checkoutConsent, null)
    const alertCalls = calls.filter((call) => call.type === 'rpc' && call.name === 'record_payment_alert')
    assert.equal(alertCalls.length, 1, `preview=${preview}`)
    assert.equal(alertCalls[0].args.p_code, 'POINT_CHARGE_POLICY_UNAVAILABLE')
    assert.equal(alerts.length, 0)
  }
})

test('충전 route: 감싸개가 unavailable 이면 503, 기존 주문이 있는 시도는 기록 함수를 부르지 않는다, route 에 스위치 분기 없음', () => {
  assert.doesNotMatch(ordersRoute, /isCheckoutConsentPreview|CHECKOUT_CONSENT_PREVIEW/)
  assert.match(ordersRoute, /if \(!attemptRow\?\.payment_order_id\) \{\s*const ack = await recordPointChargeCheckoutAck\(/)
  const prepareAt = ordersRoute.indexOf("'prepare_payment_order',")
  const ackAt = ordersRoute.indexOf('const ack = await recordPointChargeCheckoutAck(')
  assert.ok(ackAt > 0 && prepareAt > ackAt, '동의 기록 블록은 주문 준비 RPC 보다 앞')
  assert.match(ordersRoute.slice(ackAt, prepareAt), /default:\s*return checkoutNoticeUnavailableResponse\(\)/)
  // 409 대체 경로도 새 해석기로 만든 지금 판의 고지를 싣는다.
  assert.match(ordersRoute, /const freshNotice = notice \?\? await readPointChargeChangedNotice\(\)/)
})

test('충전 화면 2판: 주문 요약 아래·결제 버튼 위 CheckoutConsent, 잉크 변수, 링크 prop, isBusy 동안 잠금', () => {
  assert.match(checkoutPage, /const \{ termsLink, refundPolicyLink \} = buildMarketPurchaseInfo\(await getSiteFooterContent\(\)\)/)
  assert.match(checkoutPage, /termsLink=\{termsLink\}\s*refundPolicyLink=\{refundPolicyLink\}/)
  assert.match(checkoutPage, /<CheckoutConsentPreviewBand preview=\{preview\} \/>/)
  assert.doesNotMatch(checkoutClient, /\/terms\/refund/)
  assert.match(checkoutClient, /\[--consent-ink:var\(--ck-ink\)\] \[--consent-muted:var\(--ck-muted\)\] \[--consent-line:var\(--ck-line\)\] \[--consent-ring:var\(--ck-ink\)\]/)
  assert.match(checkoutClient, /<CheckoutConsent\s+consent=\{visibleConsent\}\s+links=\{consentLinks\}\s+checkedKeys=\{consentKeys\}\s+onCheckedKeysChange=\{setConsentKeys\}\s+disabled=\{isBusy\}\s+dialogClassName=\{`\$\{CK_INK_VARS\} \$\{CONSENT_INK_VARS\}`\}/)
  // 링크 주소가 없으면 부품 대신 고지 없음
  assert.match(checkoutClient, /const visibleConsent = consent && canRenderCheckoutConsent\(consent, consentLinks\) \? consent : null/)
  // 동의 부품은 주문 요약 다음, 결제 버튼 앞
  const summary = checkoutClient.indexOf('<OrderSummary plan={plan}')
  const consent = checkoutClient.indexOf('<CheckoutConsent\n')
  const button = checkoutClient.indexOf('onClick={beginPayment}')
  assert.ok(summary > 0 && summary < consent && consent < button)
  // 첫 값: 2판 묶음이 있으면 1판 고지는 두지 않는다(둘 중 하나만).
  assert.match(checkoutClient, /useState<PointChargeCheckoutNotice \| null>\(checkoutConsent \? null : checkoutNotice\)/)
})

test('고지 없음: 빨강이 아닌 안내 + [다시 불러오기](문서 다시 읽기), 1판 부품으로 떨어뜨리지 않음', () => {
  const unavailable = checkoutClient.slice(checkoutClient.indexOf('function CheckoutNoticeUnavailable()'), checkoutClient.indexOf('function AgreeLabel('))
  assert.match(unavailable, /결제 전 확인 내용을 불러오지 못해 지금은 결제할 수 없습니다\. 잠시 후 다시 시도해 주세요\./)
  assert.match(unavailable, /onClick=\{\(\) => window\.location\.reload\(\)\}/)
  assert.match(unavailable, /다시 불러오기/)
  assert.doesNotMatch(unavailable, /text-destructive|text-red/)
  assert.doesNotMatch(unavailable, /router\.refresh/)
  assert.doesNotMatch(checkoutClient, /id="checkout-notice-title" role="alert" className="break-keep text-destructive"/)
})

test('1판 모드: 지문 대상 문구(결제 전 확인)는 접지 않고 펼쳐 둔다', () => {
  const section = checkoutClient.slice(checkoutClient.indexOf('function CheckoutNoticeSection('), checkoutClient.indexOf('function CheckoutNoticeUnavailable()'))
  assert.doesNotMatch(section, /<details|hidden|Dialog|aria-expanded/)
  assert.match(section, /POINT_CHARGE_CHECKOUT_ITEM_KEYS\.map/)
  assert.match(section, /notice\.minorNotice/)
  const legacyCart = read('src/components/checkout/market-legacy-consent.tsx')
  assert.doesNotMatch(legacyCart, /<details|hidden=|Dialog/)
  assert.match(legacyCart, /\{notice\.confirmNotice\}/)
})

test('409 두 판: 판을 바꿔 그리고 동의(1판 체크·2판 하위)를 모두 비운다, 시도 키는 보인 고지 지문으로 갈린다', () => {
  const changed = checkoutClient.slice(checkoutClient.indexOf('CHECKOUT_CHANGED_CODES.includes(body.code)'))
  assert.match(changed, /const nextConsent = parseCheckoutConsentBundle\(body\.notice\)/)
  assert.match(changed, /setNotice\(nextConsent \? null : parsePointChargeCheckoutNotice\(body\.notice\)\)/)
  assert.match(changed, /setConsentKeys\(\[\]\)[\s\S]*?setAgreed\(false\)/)
  assert.match(checkoutClient, /getCheckoutAttemptId\([\s\S]*?plan\.credits,\s*noticeSha256\s*\)/)
})

// 구현 재검증 반영: 기록 경로 경보(DB 가 판 2 에서 닫음)
test('충전 기록 경로: NOTICE_POLICY_UNAVAILABLE + 판 2 → 경보 1회, 판 1·null → 0회, 스위치 참 → RPC·경보 0회', async () => {
  for (const [consentFormat, expected] of [[2, 1], [1, 0], [null, 0]]) {
    const { server, calls, alerts } = loadServer({ rpcResult: { ok: false, code: 'NOTICE_POLICY_UNAVAILABLE', consentFormat } })
    assert.deepEqual(await server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'unavailable' })
    assert.equal(calls.filter((call) => call.type === 'rpc').length, 1, String(consentFormat))
    assert.equal(alerts.length, expected, String(consentFormat))
    if (expected) assert.deepEqual(alerts[0], { kind: 'point_charge', details: { screen: 'record' } })
  }
  const { server, calls, alerts } = loadServer({ preview: true, rpcResult: { ok: false, code: 'NOTICE_POLICY_UNAVAILABLE', consentFormat: 2 } })
  assert.deepEqual(await server.recordPointChargeCheckoutAck(ACK_INPUT), { status: 'unavailable' })
  assert.equal(calls.filter((call) => call.type === 'rpc').length, 0)
  assert.equal(alerts.length, 0)
})
