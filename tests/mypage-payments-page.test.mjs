import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const paymentsPageSource = readFileSync(
  new URL('../src/app/(dashboard)/mypage/payments/page.tsx', import.meta.url),
  'utf8'
)

test('mypage payments query excludes zero-won and planless credit records', () => {
  assert.match(paymentsPageSource, /\.gt\('amount',\s*0\)/)
  assert.match(paymentsPageSource, /\.not\('plan_id',\s*'is',\s*null\)/)
})
