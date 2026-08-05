import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { resolveAdminGrantSourceCategory } from '../src/lib/credit-source-display.ts'

const creditsSource = readFileSync(
  new URL('../src/lib/credits.ts', import.meta.url),
  'utf8'
)

const adminGrantRouteSource = readFileSync(
  new URL('../src/app/api/admin/users/credits/route.ts', import.meta.url),
  'utf8'
)

const refundMigrationSource = readFileSync(
  new URL('../supabase/migrations/20260805120000_create_toss_refund_workflow.sql', import.meta.url),
  'utf8'
)

test('maps admin compensation and other grants to admin_grant', () => {
  assert.equal(resolveAdminGrantSourceCategory('compensation'), 'admin_grant')
  assert.equal(resolveAdminGrantSourceCategory('other'), 'admin_grant')
})

test('maps admin event grants to bonus and refund grants to system_refund', () => {
  assert.equal(resolveAdminGrantSourceCategory('event'), 'bonus')
  assert.equal(resolveAdminGrantSourceCategory('refund'), 'system_refund')
})

test('admin grants use a dedicated admin-client credit path that verifies profile balance updates', () => {
  assert.match(creditsSource, /static async grantCreditsAsAdmin/)
  assert.match(creditsSource, /const adminSupabase = createAdminClient\(\)/)
  assert.match(creditsSource, /grantCreditsAsAdmin[\s\S]*finalizeCreditBalanceMutation\(userId,\s*'Admin grant',\s*adminSupabase\)/)
})

test('admin user credit route uses the dedicated admin grant service instead of purchaseCredits', () => {
  assert.match(adminGrantRouteSource, /CreditService\.grantCreditsAsAdmin\(/)
  assert.doesNotMatch(adminGrantRouteSource, /CreditService\.purchaseCredits\(/)
})

test('refund approval atomically refreshes the valid ledger balance', () => {
  assert.match(refundMigrationSource, /create or replace function public\.finalize_toss_refund/i)
  assert.match(refundMigrationSource, /update public\.profiles/i)
})

test('credit mutations share a common ledger-first balance finalizer', () => {
  assert.match(creditsSource, /async function finalizeCreditBalanceMutation/)
  assert.match(creditsSource, /syncProfileBalanceCacheFromLedger/)
  assert.match(creditsSource, /reportCreditBalanceMismatch/)
  assert.match(creditsSource, /purchaseCredits[\s\S]*finalizeCreditBalanceMutation\(/)
  assert.match(creditsSource, /grantCreditsAsAdmin[\s\S]*finalizeCreditBalanceMutation\(/)
  assert.match(creditsSource, /deductCredits[\s\S]*finalizeCreditBalanceMutation\(/)
  assert.match(creditsSource, /refundCredits[\s\S]*finalizeCreditBalanceMutation\(/)
  assert.doesNotMatch(creditsSource, /static async approveRefund/)
})
