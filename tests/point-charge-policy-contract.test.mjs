import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const policy = read('../src/lib/point-charge-policy.ts')
const paymentConstants = read('../src/lib/payment-constants.ts')

const policyNumber = (name) => {
  const match = policy.match(new RegExp(`export const ${name} = (\\d+)\\n`))
  assert.ok(match, `${name}가 정책 모듈에 숫자로 정의되어 있다`)
  return Number(match[1])
}

// 같은 함수가 여러 마이그레이션에서 다시 정의되므로, 파일 이름 순서로 가장 나중에 적힌 값이 실제 DB 값이다.
const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const lastMigrationMatch = (pattern) => {
  let last = null
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    const source = readFileSync(new URL(file, migrationsDir), 'utf8')
    for (const match of source.matchAll(pattern)) last = { file, match }
  }
  return last
}

test('정책 모듈의 값은 환불 7일·사용기한 1년·1회 한도 100,000원이다', () => {
  assert.equal(policyNumber('POINT_CHARGE_REFUND_DAYS'), 7)
  assert.equal(policyNumber('POINT_CHARGE_VALIDITY_YEARS'), 1)
  assert.match(paymentConstants, /export const MAX_POINT_CHARGE_AMOUNT = 100_000\n/)
  assert.match(policy, /import \{ MAX_POINT_CHARGE_AMOUNT \} from '@\/lib\/payment-constants'/)
  assert.match(
    policy,
    /export const POINT_CHARGE_MAX_AMOUNT_TEXT = `\$\{MAX_POINT_CHARGE_AMOUNT\.toLocaleString\('ko-KR'\)\}원`/
  )
})

test('환불 가능 일수는 DB 환불 판정 함수의 interval과 같다', () => {
  const found = lastMigrationMatch(/v_refundable_until := v_order\.approved_at \+ interval '([^']+)'/g)
  assert.ok(found, '마이그레이션에 환불 가능 기한 계산이 있다')
  assert.equal(found.match[1], `${policyNumber('POINT_CHARGE_REFUND_DAYS')} days`, found.file)
  assert.ok(policy.includes(found.file), `정책 모듈 주석이 ${found.file}을 가리킨다`)
})

test('사용기한 연수는 DB 충전 지급 함수의 interval과 같다', () => {
  const found = lastMigrationMatch(/p_approved_at \+ interval '([^']+)'/g)
  assert.ok(found, '마이그레이션에 사용기한 계산이 있다')
  const years = policyNumber('POINT_CHARGE_VALIDITY_YEARS')
  assert.equal(found.match[1], years === 1 ? '1 year' : `${years} years`, found.file)
  assert.ok(policy.includes(found.file), `정책 모듈 주석이 ${found.file}을 가리킨다`)
})

test('회원 화면 문구는 숫자를 직접 적지 않고 정책 모듈의 값을 쓴다', () => {
  const checkout = read('../src/app/checkout/checkout-client.tsx')
  const pricingPage = read('../src/app/pricing/page.tsx')
  const pricingClient = read('../src/app/pricing/pricing-client.tsx')
  // 충전 화면 안내 문구는 설정 행(처음 값은 이 마이그레이션)이고, 숫자는 자리표시로 두고 화면이 정책 값으로 채운다.
  const pricingContentSeed = read('../supabase/migrations/20261119100000_pricing_page_content.sql')
  const termsPage = read('../src/app/terms/[documentSlug]/page.tsx')

  assert.match(checkout, /1회 최대 \{POINT_CHARGE_MAX_AMOUNT_TEXT\}입니다\./)
  assert.match(checkout, /결제일로부터 \{POINT_CHARGE_VALIDITY_YEARS\}년이며/)
  assert.match(checkout, /구매 후 \{POINT_CHARGE_REFUND_DAYS\}일 이내/)
  assert.match(pricingContentSeed, /1회 최대 \{충전한도\}까지만/)
  assert.match(pricingContentSeed, /결제일로부터 \{사용기한\}년 동안/)
  assert.match(pricingContentSeed, /구매 후 \{환불기간\}일 이내에/)
  assert.match(pricingContentSeed, /사용 기한 \{사용기한\}년/)
  assert.match(pricingPage, /'\{사용기한\}': String\(POINT_CHARGE_VALIDITY_YEARS\)/)
  assert.match(pricingPage, /'\{환불기간\}': String\(POINT_CHARGE_REFUND_DAYS\)/)
  assert.match(pricingPage, /'\{충전한도\}': POINT_CHARGE_MAX_AMOUNT_TEXT/)
  assert.match(termsPage, /1회 충전금액은 \{POINT_CHARGE_MAX_AMOUNT_TEXT\} 이하로/)
  assert.match(termsPage, /구매 후 \{POINT_CHARGE_REFUND_DAYS\}일 이내이고/)
  for (const source of [checkout, pricingPage, pricingClient, pricingContentSeed]) {
    assert.doesNotMatch(source, /100,000원|\d+년|\d+일 이내/)
  }
  // 약관 화면의 필수 문장은 약관 본문(DB·footer-content)과 글자 그대로 대조하는 값이라 글자로 둔다. 연수만 정책과 대조한다.
  assert.match(
    termsPage,
    new RegExp(`결제시점으로부터 ${policyNumber('POINT_CHARGE_VALIDITY_YEARS')}년 이내로 제한됩니다\\.`)
  )
})
