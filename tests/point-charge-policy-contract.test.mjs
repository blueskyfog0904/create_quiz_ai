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

test('정책 모듈의 값은 사용기한 1년·1회 한도 100,000원이고, 환불 기간은 코드에 없다(DB 설정)', () => {
  assert.equal(policyNumber('POINT_CHARGE_VALIDITY_YEARS'), 1)
  assert.match(paymentConstants, /export const MAX_POINT_CHARGE_AMOUNT = 100_000\n/)
  assert.match(policy, /import \{ MAX_POINT_CHARGE_AMOUNT \} from '@\/lib\/payment-constants'/)
  assert.match(
    policy,
    /export const POINT_CHARGE_MAX_AMOUNT_TEXT = `\$\{MAX_POINT_CHARGE_AMOUNT\.toLocaleString\('ko-KR'\)\}원`/
  )
  // 9번: 충전 환불 기간은 system_settings 'point_charge_policy'.refundDays(처음 값 7, 9번 마이그레이션)
  assert.doesNotMatch(policy, /export const POINT_CHARGE_REFUND_DAYS =/)
  const bundle9 = read('../supabase/migrations/20261125100000_point_charge_policy.sql')
  assert.equal(JSON.parse(bundle9.split('$json$')[1]).refundDays, 7)
})

test('환불 마감은 DB 판정 함수가 설정 일수로 계산한다(가장 나중 정의에 고정 interval 없음)', () => {
  const found = lastMigrationMatch(/v_refundable_until := ([^;]+);/g)
  assert.ok(found, '마이그레이션에 환불 마감 계산이 있다')
  assert.equal(found.file, '20261125100000_point_charge_policy.sql')
  assert.match(found.match[1], /^public\.point_charge_refund_deadline\(GREATEST\(v_order\.approved_at, v_source\.created_at\), v_days\)$/)
})

test('사용기한 연수는 DB 충전 지급 함수의 interval과 같다', () => {
  const found = lastMigrationMatch(/p_approved_at \+ interval '([^']+)'/g)
  assert.ok(found, '마이그레이션에 사용기한 계산이 있다')
  const years = policyNumber('POINT_CHARGE_VALIDITY_YEARS')
  assert.equal(found.match[1], years === 1 ? '1 year' : `${years} years`, found.file)
  assert.ok(policy.includes(found.file), `정책 모듈 주석이 ${found.file}을 가리킨다`)
})

test('회원 화면 문구는 숫자를 직접 적지 않고 정책 값(DB)을 쓴다', () => {
  const checkout = read('../src/app/checkout/checkout-client.tsx')
  const pricingPage = read('../src/app/pricing/page.tsx')
  const pricingClient = read('../src/app/pricing/pricing-client.tsx')
  // 충전 화면 안내 문구는 설정 행이다. 9번 약관 스크립트가 바꾸는 새 문구도 숫자는 자리표시로 둔다
  // (처음 값 20261119100000 seed 는 이력으로 두고 고치지 않는다).
  const policyScript = read('../supabase/scripts/20261124_bundle9_policy_text.sql')
  const termsPage = read('../src/app/terms/[documentSlug]/page.tsx')

  assert.match(checkout, /checkoutNotice/)
  assert.match(policyScript, /결제한 때부터 \{사용기한\}년 동안 쓸 수 있습니다/)
  assert.match(policyScript, /결제일 다음 날부터 \{환불기간\}일째 되는 날까지/)
  assert.match(pricingPage, /'\{사용기한\}': String\(POINT_CHARGE_VALIDITY_YEARS\)/)
  assert.match(pricingPage, /'\{환불기간\}': refundDaysText \?\? '\{환불기간\}'/)
  assert.match(pricingPage, /pointChargePolicy\.refundDays/)
  assert.match(pricingPage, /'\{충전한도\}': POINT_CHARGE_MAX_AMOUNT_TEXT/)
  for (const source of [checkout, pricingPage, pricingClient]) {
    assert.doesNotMatch(source, /100,000원|\d+년|\d+일 이내|\d+일째/)
  }
  // 9번: 약관 화면은 DB 약관 본문만 그린다(코드에 박은 대체 섹션 없음).
  assert.doesNotMatch(termsPage, /POINT_CHARGE_REFUND_DAYS|POINT_CHARGE_MAX_AMOUNT_TEXT/)
})
