import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(path, 'utf8')

test('point-charge policy limits the current credit use case to the problem market', () => {
  const migration = read(
    'supabase/migrations/20260818085622_update_point_charge_provider_policy.sql'
  )
  const termsPage = read('src/app/terms/[documentSlug]/page.tsx')

  assert.match(
    migration,
    /'사용 경로: 영어·국어 문제마켓 자료 구매\. 사용 내역은 \/mypage\/credits/
  )
  assert.match(termsPage, /카카오페이 직접결제는 별도 운영 승인 후/)
  assert.match(termsPage, /카카오페이머니만/)
})

test('operations runbook keeps provider gates and the Toss variant blocker explicit', () => {
  const runbook = read('docs/tosspayments-point-charge-operations.md')
  const plan = read('docs/toss-kakaopay-dual-payment-implementation-plan.md')

  assert.match(runbook, /TOSS_PAYMENTS_ENABLED/)
  assert.match(runbook, /KAKAOPAY_PAYMENTS_ENABLED/)
  assert.match(runbook, /kakaopay_accepts_new_orders/)
  assert.match(runbook, /카카오페이머니/)
  assert.match(plan, /HscADqm7wtbjZLag9xdFx6V4pLsZ/)
  assert.match(plan, /Toss 상점관리자 로그인 필요/)
  assert.match(plan, /kakaopay_accepts_new_orders=false/)
})
