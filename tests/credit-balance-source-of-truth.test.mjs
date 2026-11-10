import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const balanceSource = readFileSync(
  new URL('../src/lib/credit-balance.ts', import.meta.url),
  'utf8'
)

const creditsSource = readFileSync(
  new URL('../src/lib/credits.ts', import.meta.url),
  'utf8'
)

const backfillSql = readFileSync(
  new URL('../scripts/backfill-profile-credits-from-ledger.sql', import.meta.url),
  'utf8'
)

test('defines ledger, spendable, and snapshot helpers for credit balances', () => {
  assert.match(balanceSource, /export interface CreditBalanceSnapshot/)
  assert.match(balanceSource, /export async function getLedgerBalance/)
  assert.match(balanceSource, /export async function getSpendableBalance/)
  assert.match(balanceSource, /export async function getCreditBalanceSnapshot/)
})

test('treats pending_refund separately from active spendable credits', () => {
  assert.match(balanceSource, /get_credit_balance_snapshot/)
  assert.match(balanceSource, /spendableBalance/)
  assert.match(balanceSource, /ledgerBalance/)
})

test('snapshot compares profile, ledger, and latest transaction balances', () => {
  assert.match(balanceSource, /profileBalance/)
  assert.match(balanceSource, /latestTransactionBalance/)
  assert.match(balanceSource, /hasMismatch/)
  assert.match(balanceSource, /mismatchReasons/)
  assert.match(balanceSource, /displayBalance/)
  assert.match(balanceSource, /displayBalance:\s*spendableBalance/)
  assert.match(balanceSource, /expiredBalance/)
  assert.match(balanceSource, /nextExpirationAt/)
  assert.match(balanceSource, /export function logCreditBalanceMismatch/)
  assert.match(balanceSource, /reconcileRequired:\s*snapshot\.hasMismatch/)
  assert.match(balanceSource, /export function selectDisplayBalance/)
  assert.doesNotMatch(balanceSource, /CREDIT_LEDGER_DISPLAY_ENABLED/)
  assert.match(balanceSource, /export async function reportCreditBalanceMismatch/)
  assert.match(balanceSource, /createAdminClient/)
  assert.match(balanceSource, /\.from\('notifications'\)[\s\S]*?\.insert/)
})

// CreditService의 한 정적 메서드 본문(다음 정적 메서드 전까지)을 잘라 낸다.
function methodBody(name) {
  const start = creditsSource.indexOf(`static async ${name}(`)
  assert.notEqual(start, -1, name)
  const next = creditsSource.indexOf('static async ', start + 1)
  return creditsSource.slice(start, next === -1 ? undefined : next)
}

test('write paths run post-write balance snapshot verification; only purchase still syncs the cache itself', () => {
  assert.match(creditsSource, /async function finalizeCreditBalanceMutation/)
  assert.match(creditsSource, /finalizeCreditBalanceMutation[\s\S]*?syncProfileBalanceCacheFromLedger/)
  assert.match(creditsSource, /finalizeCreditBalanceMutation[\s\S]*?getCreditBalanceSnapshot/)
  assert.match(creditsSource, /finalizeCreditBalanceMutation[\s\S]*?reportCreditBalanceMismatch/)
  assert.match(balanceSource, /export async function syncProfileBalanceCacheFromLedger/)
  assert.match(methodBody('purchaseCredits'), /finalizeCreditBalanceMutation\(userId,\s*'Purchase',\s*adminSupabase\)/)
  // RPC가 profiles 잠금 아래 캐시를 맞추므로, 커밋 뒤에는 실패를 무시하는 점검만 한다.
  assert.match(creditsSource, /async function reportCreditBalanceAfterMutation[\s\S]*?getCreditBalanceSnapshot[\s\S]*?reportCreditBalanceMismatch[\s\S]*?catch/)
  assert.match(methodBody('grantCreditsAsAdmin'), /reportCreditBalanceAfterMutation\(userId,\s*'Admin grant'\)/)
  assert.match(methodBody('deductCredits'), /reportCreditBalanceAfterMutation\(userId,\s*'Deduct'\)/)
  assert.match(methodBody('refundCredits'), /reportCreditBalanceAfterMutation\(userId,\s*'Refund'\)/)
  for (const name of ['grantCreditsAsAdmin', 'deductCredits', 'refundCredits']) {
    assert.doesNotMatch(methodBody(name), /finalizeCreditBalanceMutation|syncProfileBalanceCacheFromLedger/, name)
  }
  assert.doesNotMatch(creditsSource, /static async approveRefund/)
})

test('backfill SQL script updates profile cache from ledger balance idempotently', () => {
  assert.match(backfillSql, /with source_balance as/)
  assert.match(backfillSql, /status in \('active', 'pending_refund'\)/)
  assert.match(backfillSql, /update profiles p/)
  assert.match(backfillSql, /set credits = source_balance\.ledger_balance/)
  assert.match(backfillSql, /where p\.id = source_balance\.user_id/)
})
