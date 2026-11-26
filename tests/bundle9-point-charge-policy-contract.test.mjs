import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'

// 9번 묶음(docs/plan-bundle9-payment-refund-notice.md): 결제·환불 안내 DB화 + 다시 지급한 크레딧 처리
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261125100000_point_charge_policy.sql')
const seedPolicy = JSON.parse(migration.split('$json$')[1])

const policyLib = load('src/lib/point-charge-policy.ts', {
  '@/lib/payment-constants': { MAX_POINT_CHARGE_AMOUNT: 100000 },
})
const policyServer = load('src/lib/point-charge-policy-server.ts', {
  'server-only': {},
  'next/cache': { revalidateTag: () => {}, unstable_cache: (fn) => fn },
  '@/lib/supabase/bypass': { createAdminClient: () => { throw new Error('not used') } },
  '@/lib/point-charge-policy': policyLib,
  // 11번: 2판(접는 동의) 읽기·개발 스위치. 이 시험은 1판 지문·저장만 본다.
  '@/lib/checkout-consent': load('src/lib/checkout-consent.ts', { '@/lib/point-charge-policy': policyLib }),
  '@/lib/checkout-consent-server': {
    buildCheckoutConsentBundle: () => null,
    buildCheckoutConsentBundleIgnoringLinks: () => null,
    readRawSiteFooterValue: async () => null,
    recordCheckoutConsentUnavailableAlert: async () => {},
  },
  '@/lib/checkout-consent-preview': { isCheckoutConsentPreview: () => false, readCheckoutConsentPreviewKeys: async () => null },
})

const REDEFINED = [
  'get_point_charge_refund_eligibility',
  'quarantine_external_provider_cancellation',
  'quarantine_payapp_partial_cancellation',
  'process_payapp_cancellation',
  'complete_manual_point_charge_refund',
  'market_refund_allocate',
]

// 사전 점검 표의 원래 지문(md5(pg_get_functiondef)).
const precheck = migration.slice(0, migration.indexOf('v_new text[][]'))
const originalMd5 = Object.fromEntries(
  Array.from(precheck.matchAll(/ARRAY\['public\.(\w+)\([^']*\)', '([0-9a-f]{32})'\]/g), (m) => [m[1], m[2]])
)

function definition(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, name)
  const end = migration.indexOf('\n$function$;\n', start)
  assert.ok(end > start, name)
  return migration.slice(start, end + '\n$function$'.length)
}

// [9번] 구역을 걷어내고 '-- [9번 원래] ' 줄을 되살리면 운영 원래 정의와 글자 하나까지 같아야 한다.
function stripBundle9(body) {
  const out = []
  let inside = false
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '-- [9번] 시작') { assert.equal(inside, false); inside = true; continue }
    if (trimmed === '-- [9번] 끝') { assert.equal(inside, true); inside = false; continue }
    if (line.startsWith('-- [9번 원래] ')) { assert.equal(inside, true); out.push(line.slice('-- [9번 원래] '.length)); continue }
    if (!inside) out.push(line)
  }
  assert.equal(inside, false)
  return `${out.join('\n')}\n`
}

test('재정의 함수 6개 = 운영 원래 정의 + [9번] 구역만', () => {
  for (const name of REDEFINED) {
    const body = definition(name)
    assert.ok(body.includes('-- [9번] 시작'), `${name}: 9번 구역 없음`)
    const md5 = createHash('md5').update(stripBundle9(body), 'utf8').digest('hex')
    assert.equal(md5, originalMd5[name], `${name}: 원래 정의와 다름`)
  }
})

test('되돌리기 (가)·(나)는 원래 정의를 그대로 담는다', () => {
  const downA = read('supabase/rollback/20261125100000_point_charge_policy_down_a.sql')
  const downB = read('supabase/rollback/20261125100000_point_charge_policy_down_b.sql')
  for (const name of REDEFINED) {
    const original = stripBundle9(definition(name))
    const target = name === 'get_point_charge_refund_eligibility' ? downB : downA
    assert.ok(target.includes(original.trimEnd()), `${name}: 되돌리기 파일에 원래 정의 없음`)
    assert.ok(target.includes(originalMd5[name]), `${name}: 되돌리기 VERIFY 지문 없음`)
  }
  assert.match(downA, /DOWN_A_BLOCKED: manual_review requests exist/)
  assert.match(downB, /DOWN_B_BLOCKED: checkout acks exist/)
})

test('결제 전 확인 지문: TS 계산 = DB 함수(리허설에서 SQL 이 낸 값)', () => {
  const policy = policyLib.parsePointChargePolicy(seedPolicy)
  assert.ok(policy)
  assert.equal(policy.refundDays, 7)
  const notice = policyServer.toPointChargeCheckoutNotice(policy)
  // 2026-11-23 운영 DB 리허설(BEGIN…ROLLBACK)에서 record_point_charge_checkout_ack 가 돌려준 noticeSha256
  assert.equal(notice.noticeSha256, '5065a73ec24ffc8aaca6a28e2687914428f3111b2a474f6b4991f95c37f5589b')
  assert.ok(!notice.checkoutItems.refund.includes('{충전환불기간}'))
  assert.match(notice.checkoutItems.refund, /다음 날부터 7일째/)
  const text = policyLib.buildPointChargeNoticeText(policy)
  assert.equal(text.split('\n').length, 8)
  assert.ok(text.startsWith(`${policy.checkoutTitle}\n`))
})

test('설정 해석·저장 검사: 자리표시 규칙과 법정 최소 일수', () => {
  assert.equal(policyLib.parsePointChargePolicy({ ...seedPolicy, refundDays: 6 }), null)
  assert.equal(policyLib.parsePointChargePolicy({ ...seedPolicy, refundDays: '7' }), null)
  assert.equal(policyLib.parsePointChargePolicy({ ...seedPolicy, checkoutItems: { ...seedPolicy.checkoutItems, refund: '7일 안에 환불' } }), null)
  assert.equal(policyLib.parsePointChargePolicy({ ...seedPolicy, minorNotice: '{오류}' }), null)
  const policy = policyLib.parsePointChargePolicy(seedPolicy)
  const texts = { ...policy }
  delete texts.version
  delete texts.refundDays
  assert.equal(policyLib.validatePointChargePolicyTexts(texts), null)
  assert.match(policyLib.validatePointChargePolicyTexts({ ...texts, checkoutItems: { ...texts.checkoutItems, refund: '결제 후 {충전환불기간}일, 최대 7일' } }), /숫자로 적지/)
  assert.match(policyLib.validatePointChargePolicyTexts({ ...texts, agreeLabel: '' }), /입력해 주세요/)
})

test('DB: 판정은 설정·동의 일수 중 긴 것, 마감은 자료 환불과 같은 셈법, 쓰기 없음(STABLE)', () => {
  const body = definition('get_point_charge_refund_eligibility')
  assert.match(body, /v_days := COALESCE\(GREATEST\(v_setting_days, v_ack_days\), 7\);/)
  assert.match(body, /point_charge_refund_deadline\(GREATEST\(v_order\.approved_at, v_source\.created_at\), v_days\)/)
  assert.match(body, /IF NOT \(now\(\) < v_refundable_until\) THEN/)
  assert.match(body, /'REFUND_REISSUED_SOURCE'/)
  assert.match(body, /\n STABLE SECURITY DEFINER\n/)
  assert.match(migration, /SELECT CASE WHEN p_base IS NULL OR p_days IS NULL THEN NULL ELSE public\.market_refund_deadline\(p_base, p_days\) END/)
})

test('POINT_CHARGE_REFUND_DAYS 상수는 없다(기간은 DB 값)', () => {
  assert.doesNotMatch(read('src/lib/point-charge-policy.ts'), /POINT_CHARGE_REFUND_DAYS\b(?!_)/)
})

test('충전 환불 마감은 코드에서 계산하지 않는다: 크레딧 화면·결제 내역은 판정 함수의 refundable_until 만 쓴다', () => {
  const details = read('src/lib/mypage-payment-details-server.ts')
  const credits = read('src/app/(solvook)/mypage/credits/_components/credits-view.tsx')
  const payments = read('src/app/(solvook)/mypage/payments/_components/payments-view.tsx')
  const refunds = read('src/lib/point-charge-refunds-server.ts')
  assert.match(details, /getPointChargeRefundEligibility\(/)
  assert.match(details, /refundableUntil: eligibility\.refundableUntil/)
  // 동의 행은 payment_orders.checkout_attempt_id → checkout_attempts.id → (user_id, checkout_attempt_id) 로 찾는다.
  assert.match(details, /from\('checkout_attempts'\)/)
  assert.match(details, /from\('point_charge_checkout_acks'\)/)
  assert.match(credits, /formatMarketRefundLastDay\(source\.refundableUntil\)/)
  assert.match(payments, /formatMarketRefundLastDay\(detail\.refundDeadline\.refundableUntil\)/)
  for (const source of [details, credits, payments, refunds]) {
    assert.doesNotMatch(source, /POINT_CHARGE_REFUND_DAYS|7일|setDate\(|addDays|86_?400_?000/)
  }
})

test('카카오페이 주문은 코드로 막는다(503 PAYMENT_PROVIDER_RETIRED)', () => {
  const route = read('src/app/api/payments/kakaopay/orders/route.ts')
  assert.match(route, /PAYMENT_PROVIDER_RETIRED/)
  assert.match(route, /status: 503/)
  assert.doesNotMatch(route, /prepare_payment_order/)
})

test('재지급 크레딧 거절 사유: DB 문구와 코드 대체 문장이 모두 확정 문구 그대로(미성년자·서비스 종료 경로를 가리지 않음)', () => {
  const expected = '자료 환불로 다시 받은 크레딧은 단순 변심 결제 취소 대상이 아닙니다(미성년자 결제 취소·서비스 종료는 취소·환불정책 7·8절).'
  assert.equal(seedPolicy.refundBlockReasons.REFUND_REISSUED_SOURCE, expected)
  const refunds = read('src/lib/point-charge-refunds-server.ts')
  const fallbacks = Array.from(refunds.matchAll(/REFUND_REISSUED_SOURCE: '([^']+)'/g), (m) => m[1])
  assert.equal(fallbacks.length, 2)
  for (const text of fallbacks) assert.equal(text, expected)
  const policy = policyLib.parsePointChargePolicy(seedPolicy)
  const texts = { ...policy }
  delete texts.version
  delete texts.refundDays
  assert.match(policyLib.validatePointChargePolicyTexts({ ...texts, agreeLabel: `${texts.agreeLabel} (필수)` }), /\(필수\)/)
})
