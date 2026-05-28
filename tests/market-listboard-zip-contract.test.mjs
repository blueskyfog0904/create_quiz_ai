import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const listApi = readFileSync(new URL('../src/app/api/market/[slug]/items/route.ts', import.meta.url), 'utf8')
const listClient = readFileSync(new URL('../src/app/(dashboard)/market/[slug]/market-listboard-client.tsx', import.meta.url), 'utf8')
const listServer = readFileSync(new URL('../src/app/(dashboard)/market/[slug]/market-listboard.tsx', import.meta.url), 'utf8')
const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('market list api and server rows support zip and sample-pages-only sample filtering', () => {
  assert.match(listApi, /z\.enum\(\['all', 'sample', 'pdf', 'hwp', 'zip'\]\)/)
  assert.match(itemsServer, /assetKind\?: 'pdf' \| 'hwp' \| 'zip' \| 'sample' \| 'all'/)
  assert.match(itemsServer, /zip_price/)
  assert.match(itemsServer, /zip:\s*MarketListboardAssetRow/)
  assert.match(itemsServer, /filters\.assetKind === 'zip'/)
  assert.match(itemsServer, /filters\.assetKind === 'sample'/)
  assert.match(itemsServer, /listActiveMarketItemSamplePagesForItems/)
})

test('market listboard client exposes zip as an independent detail-purchase file kind', () => {
  assert.match(listClient, /zip/)
  assert.match(listClient, /ZIP/)
  assert.match(listClient, /PDF[\s\S]+HWP & PDF[\s\S]+ZIP/)
  assert.match(listClient, /상세에서 구매/)
  assert.doesNotMatch(listClient, /zipCount/)
  assert.doesNotMatch(listClient, /selectionSummary/)
  assert.match(listServer, /zip|ZIP/)
})

test('market listboard hides unavailable paid file options instead of showing unavailable pills', () => {
  assert.match(listClient, /if \(!asset\.available\) \{\s*return null\s*\}/)
  assert.doesNotMatch(listClient, /\{formatLabel\} 미제공/)
  assert.doesNotMatch(listClient, /\$\{row\.title\} \$\{formatLabel\} 미제공/)
})


test('market listboard no longer owns purchase success UI because purchases happen on detail pages', () => {
  assert.doesNotMatch(listClient, /MarketPurchaseCompleteDialog/)
  assert.doesNotMatch(listClient, /purchaseCompleteMessage/)
  assert.doesNotMatch(listClient, /toast\.success\(payload\.message/)
  assert.doesNotMatch(listClient, /api\/market\/purchases\/batch/)
})
