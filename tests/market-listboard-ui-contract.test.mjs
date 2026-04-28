import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const listboardServer = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/market-listboard.tsx', import.meta.url),
  'utf8'
)
const listboardClient = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/market-listboard-client.tsx', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)

test('market listboard rows expose sample metadata without making sample purchasable', () => {
  assert.match(marketItemsServer, /MarketListboardSampleRow/)
  assert.match(marketItemsServer, /sample:\s*MarketListboardSampleRow/)
  assert.match(marketItemsServer, /'pdf', 'hwp', 'sample'/)
  assert.match(marketItemsServer, /sample:\s*\{\s*available:/s)
  assert.doesNotMatch(listboardClient, /assetKind:\s*'sample'/)
})

test('market listboard keeps workspace-aware navigation and filter chips', () => {
  assert.match(listboardServer, /WorkspaceLink/)
  assert.match(listboardClient, /WorkspaceLink/)
  assert.match(listboardServer, /적용된 조건/)
  assert.match(listboardServer, /자료 찾기/)
})

test('market listboard has responsive product-list UI and accessible asset states', () => {
  assert.match(listboardClient, /hidden[^\n]+md:block/)
  assert.match(listboardClient, /md:hidden/)
  assert.match(listboardClient, /샘플 제공/)
  assert.match(listboardClient, /구매 가능/)
  assert.match(listboardClient, /선택됨/)
  assert.match(listboardClient, /보유/)
  assert.match(listboardClient, /미제공/)
  assert.match(listboardClient, /aria-label=\{`\$\{row.title\} \$\{formatLabel\} \$\{stateLabel\}`\}/)
})

test('market listboard purchase tray and failure states are explicit', () => {
  assert.match(listboardClient, /선택 파일 결제/)
  assert.match(listboardClient, /pb-\[env\(safe-area-inset-bottom\)\]/)
  assert.match(listboardClient, /status === 401/)
  assert.match(listboardClient, /status === 402/)
  assert.match(listboardClient, /status === 409/)
  assert.match(listboardClient, /status >= 500/)
})
