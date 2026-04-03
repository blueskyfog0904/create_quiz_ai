import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const downloadRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url),
  'utf8'
)

const purchaseRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)

const viewRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/view/route.ts', import.meta.url),
  'utf8'
)

const batchPurchaseRoute = readFileSync(
  new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url),
  'utf8'
)

test('direct market item routes do not force DEFAULT_WORKSPACE_SUBJECT for item-id lookups', () => {
  assert.doesNotMatch(downloadRoute, /DEFAULT_WORKSPACE_SUBJECT/)
  assert.doesNotMatch(purchaseRoute, /DEFAULT_WORKSPACE_SUBJECT/)
  assert.doesNotMatch(viewRoute, /DEFAULT_WORKSPACE_SUBJECT/)
})

test('batch market purchase route does not force DEFAULT_WORKSPACE_SUBJECT for item-id lookups', () => {
  assert.doesNotMatch(batchPurchaseRoute, /DEFAULT_WORKSPACE_SUBJECT/)
})
