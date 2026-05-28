import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const listClient = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/market-listboard-client.tsx', import.meta.url),
  'utf8'
)
const listServer = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/market-listboard.tsx', import.meta.url),
  'utf8'
)
const batchRoute = readFileSync(new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url), 'utf8')

test('market listboard no longer exposes direct purchase state or confirmation UI', () => {
  assert.doesNotMatch(listClient, /CreditConfirmationDialog/)
  assert.doesNotMatch(listClient, /selectedKeys/)
  assert.doesNotMatch(listClient, /selectionSummary/)
  assert.doesNotMatch(listClient, /api\/market\/purchases\/batch/)
  assert.doesNotMatch(listClient, /선택 파일 결제/)
  assert.doesNotMatch(listClient, /useLoginRedirect/)
  assert.doesNotMatch(listClient, /toast/)
  assert.doesNotMatch(listServer, /일괄 결제/)
  assert.doesNotMatch(listServer, /선택해 바로 구매/)
  assert.match(listServer, /상세페이지에서 구매/)
})

test('market listboard file column points users to item detail purchase flow', () => {
  assert.match(listClient, /상세에서 구매/)
  assert.match(listClient, /WorkspaceLink/)
  assert.match(listClient, /\/market\/\$\{categorySlug\}\/items\/\$\{row\.itemId\}/)
  assert.match(listClient, /row\.sample\.available/)
})

test('legacy batch purchase API is explicitly deprecated and cannot create purchases', () => {
  assert.match(batchRoute, /BATCH_PURCHASE_DEPRECATED/)
  assert.match(batchRoute, /status:\s*410/)
  assert.match(batchRoute, /상세페이지에서 구매/)
  assert.doesNotMatch(batchRoute, /CreditService\.deductCredits/)
  assert.doesNotMatch(batchRoute, /createMarketPurchases/)
  assert.doesNotMatch(batchRoute, /rollbackMarketPurchases/)
})
