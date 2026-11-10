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

// CreditService의 한 정적 메서드 본문(다음 정적 메서드 전까지)을 잘라 낸다.
function methodBody(name) {
  const start = creditsSource.indexOf(`static async ${name}(`)
  assert.notEqual(start, -1, name)
  const next = creditsSource.indexOf('static async ', start + 1)
  return creditsSource.slice(start, next === -1 ? undefined : next)
}

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
  // 원천·결제 이력·거래·캐시는 grant_admin_credits RPC 한 트랜잭션에서 기록한다.
  assert.match(methodBody('grantCreditsAsAdmin'), /rpc\('grant_admin_credits'/)
  assert.match(methodBody('grantCreditsAsAdmin'), /reportCreditBalanceAfterMutation\(userId,\s*'Admin grant'\)/)
  assert.doesNotMatch(methodBody('grantCreditsAsAdmin'), /finalizeCreditBalanceMutation|\.from\('credit_sources'\)/)
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
  assert.match(methodBody('purchaseCredits'), /finalizeCreditBalanceMutation\(/)
  // deduct·refund·grant는 RPC 커밋 뒤 실패를 무시하는 점검만 한다.
  for (const name of ['grantCreditsAsAdmin', 'deductCredits', 'refundCredits']) {
    assert.doesNotMatch(methodBody(name), /finalizeCreditBalanceMutation\(/, name)
    assert.match(methodBody(name), /reportCreditBalanceAfterMutation\(/, name)
  }
  assert.doesNotMatch(creditsSource, /static async approveRefund/)
})
