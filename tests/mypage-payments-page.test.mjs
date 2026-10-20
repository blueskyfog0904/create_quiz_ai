import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const paymentsPageSource = readFileSync(
  new URL('../src/app/(solvook)/mypage/payments/page.tsx', import.meta.url),
  'utf8'
)

// 결제내역은 get_my_payment_history RPC로 읽고, 0원·요금제 없는 기록은 filterRealPaidPlanPurchases가 뺀다.
test('mypage payments query excludes zero-won and planless credit records', () => {
  assert.match(paymentsPageSource, /supabase\.rpc\('get_my_payment_history'\)/)
  assert.match(paymentsPageSource, /filterRealPaidPlanPurchases\(paymentRecords\)/)
})
