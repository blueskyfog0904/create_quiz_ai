import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const balanceRouteSource = readFileSync(
  new URL('../src/app/api/credits/balance/route.ts', import.meta.url),
  'utf8'
)

const headerSource = readFileSync(
  new URL('../src/components/layout/header.tsx', import.meta.url),
  'utf8'
)

const mypageCreditsSource = readFileSync(
  new URL('../src/app/(dashboard)/mypage/credits/page.tsx', import.meta.url),
  'utf8'
)

test('credits balance API uses the credit balance snapshot helper during transition', () => {
  assert.match(balanceRouteSource, /getCreditBalanceSnapshot/)
  assert.match(balanceRouteSource, /selectDisplayBalance/)
  assert.match(balanceRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(balanceRouteSource, /buildCreditBalanceResponseFields\(snapshot,\s*displayBalance\)/)
})

test('header reads displayed balance from ledger-aware helper instead of raw profiles.credits', () => {
  assert.match(headerSource, /getCreditBalanceSnapshot/)
  assert.match(headerSource, /selectDisplayBalance/)
  assert.doesNotMatch(headerSource, /creditBalance=\{profile\?\.credits \?\? 0\}/)
})

test('mypage credits page reads balance from ledger-aware helper instead of raw profiles.credits', () => {
  assert.match(mypageCreditsSource, /getCreditBalanceSnapshot/)
  assert.match(mypageCreditsSource, /selectDisplayBalance/)
  assert.doesNotMatch(mypageCreditsSource, /balance=\{profile\?\.credits \?\? 0\}/)
})
