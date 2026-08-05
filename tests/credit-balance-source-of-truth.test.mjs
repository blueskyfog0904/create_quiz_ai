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

test('purchase and refund write paths also run post-write balance snapshot verification', () => {
  assert.match(creditsSource, /async function finalizeCreditBalanceMutation/)
  assert.match(creditsSource, /finalizeCreditBalanceMutation[\s\S]*?syncProfileBalanceCacheFromLedger/)
  assert.match(creditsSource, /finalizeCreditBalanceMutation[\s\S]*?getCreditBalanceSnapshot/)
  assert.match(creditsSource, /finalizeCreditBalanceMutation[\s\S]*?reportCreditBalanceMismatch/)
  assert.match(balanceSource, /export async function syncProfileBalanceCacheFromLedger/)
  assert.match(creditsSource, /purchaseCredits[\s\S]*?finalizeCreditBalanceMutation\(userId,\s*'Purchase',\s*adminSupabase\)/)
  assert.match(creditsSource, /grantCreditsAsAdmin[\s\S]*?finalizeCreditBalanceMutation\(userId,\s*'Admin grant',\s*adminSupabase\)/)
  assert.match(creditsSource, /deductCredits[\s\S]*?finalizeCreditBalanceMutation\(\s*userId,\s*'Deduct',\s*adminSupabase\s*\)/)
  assert.match(creditsSource, /refundCredits[\s\S]*?finalizeCreditBalanceMutation\(\s*userId,\s*'Refund',\s*adminSupabase\s*\)/)
  assert.doesNotMatch(creditsSource, /static async approveRefund/)
})

test('backfill SQL script updates profile cache from ledger balance idempotently', () => {
  assert.match(backfillSql, /with source_balance as/)
  assert.match(backfillSql, /status in \('active', 'pending_refund'\)/)
  assert.match(backfillSql, /update profiles p/)
  assert.match(backfillSql, /set credits = source_balance\.ledger_balance/)
  assert.match(backfillSql, /where p\.id = source_balance\.user_id/)
})
