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
  // 9번: 약관 화면은 DB 본문만 보여 준다. 결제수단 문장은 약관 본문(기본값 footer-content)에 있다.
  assert.match(read('src/lib/footer-content.ts'), /신용·체크카드, 네이버페이, 토스페이, 휴대폰\s+결제를 사용할 수 있습니다/)
  assert.doesNotMatch(termsPage, /페이코|카카오페이|일반결제|결제를 사용할 수 있습니다/)
})

test('operations docs keep provider gates explicit for PayApp and KakaoPay', () => {
  const plan = read('docs/payapp-kakaopay-payment-implementation-plan.md')
  const checklist = read('docs/payapp-db-migration-checklist.md')

  assert.match(plan, /PAYAPP_USERID/)
  assert.match(plan, /PAYMENTS_ENABLED/)
  assert.match(plan, /payapp_accepts_new_orders/)
  assert.match(plan, /KAKAOPAY_\*/)
  assert.match(checklist, /payapp_accepts_new_orders=true/)
})
