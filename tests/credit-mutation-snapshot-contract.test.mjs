import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const creditBalanceSource = readFileSync(
  new URL('../src/lib/credit-balance.ts', import.meta.url),
  'utf8'
)

const paymentsConfirmRouteSource = readFileSync(
  new URL('../src/app/api/payments/confirm/route.ts', import.meta.url),
  'utf8'
)

const marketPurchaseRouteSource = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)

const marketBatchRouteSource = readFileSync(
  new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url),
  'utf8'
)

const questionsGenerateRouteSource = readFileSync(
  new URL('../src/app/api/questions/generate/route.ts', import.meta.url),
  'utf8'
)

const saveFromCommunityRouteSource = readFileSync(
  new URL('../src/app/api/questions/save-from-community/route.ts', import.meta.url),
  'utf8'
)

const listboardRunRouteSource = readFileSync(
  new URL('../src/app/api/generate/listboard-jobs/[jobId]/run/route.ts', import.meta.url),
  'utf8'
)

const listboardRetryRouteSource = readFileSync(
  new URL('../src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts', import.meta.url),
  'utf8'
)

test('credit balance helper exposes a reusable response-fields builder for mutation routes', () => {
  assert.match(creditBalanceSource, /export function buildCreditBalanceResponseFields/)
  assert.match(creditBalanceSource, /export function selectDisplayBalance/)
  assert.match(creditBalanceSource, /balance:\s*displayBalance/)
  assert.match(creditBalanceSource, /profileBalance:\s*snapshot\.profileBalance/)
  assert.match(creditBalanceSource, /ledgerBalance:\s*snapshot\.ledgerBalance/)
  assert.match(creditBalanceSource, /spendableBalance:\s*snapshot\.spendableBalance/)
  assert.match(creditBalanceSource, /latestTransactionBalance:\s*snapshot\.latestTransactionBalance/)
  assert.match(creditBalanceSource, /hasMismatch:\s*snapshot\.hasMismatch/)
  assert.match(creditBalanceSource, /mismatchReasons:\s*snapshot\.mismatchReasons/)
})

test('payments confirm route returns snapshot-backed balance fields', () => {
  assert.match(paymentsConfirmRouteSource, /getCreditBalanceSnapshot/)
  assert.match(paymentsConfirmRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(paymentsConfirmRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})

test('market purchase single and batch routes share snapshot-backed balance fields', () => {
  assert.match(marketPurchaseRouteSource, /getCreditBalanceSnapshot/)
  assert.match(marketPurchaseRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(marketPurchaseRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)

  assert.match(marketBatchRouteSource, /getCreditBalanceSnapshot/)
  assert.match(marketBatchRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(marketBatchRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})

test('questions generate route uses snapshot-backed balance fields across response branches', () => {
  assert.match(questionsGenerateRouteSource, /getCreditBalanceSnapshot/)
  assert.match(questionsGenerateRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(questionsGenerateRouteSource, /jsonWithBalanceSnapshot/)
  assert.match(questionsGenerateRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})

test('save-from-community routes use snapshot-backed balance fields across response branches', () => {
  assert.match(saveFromCommunityRouteSource, /getCreditBalanceSnapshot/)
  assert.match(saveFromCommunityRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(saveFromCommunityRouteSource, /jsonWithBalanceSnapshot/)
  assert.match(saveFromCommunityRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})

test('listboard run and retry routes return snapshot-backed balance fields', () => {
  assert.match(listboardRunRouteSource, /getCreditBalanceSnapshot/)
  assert.match(listboardRunRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(listboardRunRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)

  assert.match(listboardRetryRouteSource, /getCreditBalanceSnapshot/)
  assert.match(listboardRetryRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(listboardRetryRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})
