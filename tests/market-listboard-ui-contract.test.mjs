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
  assert.match(marketItemsServer, /listActiveMarketItemSamplePagesForItems/)
  assert.match(marketItemsServer, /sample:\s*\{\s*available:[\s\S]+pageCount:/)
  assert.doesNotMatch(listboardClient, /assetKind:\s*'sample'/)
})

test('market listboard provides sample preview column after file column', () => {
  assert.match(listboardClient, /MarketSamplePreviewDialog/)
  assert.match(listboardClient, /workspaceSubject/)
  assert.match(listboardClient, /samplePreviewItemId/)
  assert.match(listboardClient, /setSamplePreviewItemId\(itemId\)/)
  assert.match(listboardClient, /openSamplePreview\(row\.itemId\)/)
  assert.match(listboardClient, /row\.sample\.available/)
  assert.match(
    listboardClient,
    /<th className="min-w-\[410px\][\s\S]+>파일<\/th>[\s\S]+<th className="w-\[96px\][\s\S]+>샘플<\/th>/
  )
  assert.match(listboardClient, /aria-label=\{`\$\{row\.title\} 샘플보기`\}/)
  assert.match(listboardClient, /샘플보기/)
})

test('market listboard keeps workspace-aware navigation and filter chips', () => {
  assert.match(listboardServer, /WorkspaceLink/)
  assert.match(listboardClient, /WorkspaceLink/)
  assert.match(listboardServer, /workspaceLabel/)
  assert.match(listboardServer, /국어문제마켓/)
  assert.match(listboardServer, /영어문제마켓/)
  assert.match(listboardServer, /적용된 조건/)
  assert.match(listboardServer, /자료 찾기/)
})

test('market listboard uses the shared compact board UI for every market slug', () => {
  assert.match(listboardClient, /border-t-2 border-slate-950/, 'board should use the strong top divider')
  assert.match(listboardClient, /min-w-\[1080px\]/, 'board should keep enough horizontal room for market columns')
  assert.match(listboardClient, /min-w-\[410px\]/, 'file column should keep PDF and HWP & PDF on one line')
  assert.match(listboardClient, /flex-nowrap/, 'file choices should not wrap')
  assert.match(listboardClient, /py-2/, 'rows should use compact vertical padding')
  assert.match(listboardClient, /md:grid-cols-\[1fr_auto_1fr\]/, 'pagination row should center controls with balanced columns')
  assert.match(listboardClient, /justify-self-center/, 'pagination controls should be visually centered')
  assert.doesNotMatch(listboardClient, /formatExamMeta/, 'board rows should not show secondary exam metadata under titles')
  assert.doesNotMatch(listboardClient, /Sparkles/, 'board rows should not show sample badges under titles')
  assert.doesNotMatch(listboardClient, /게시판형 디자인 테스트/, 'production component should not contain preview-only copy')
})

test('market listboard purchase tray and failure states are explicit', () => {
  assert.match(listboardClient, /선택 파일 결제/)
  assert.match(listboardClient, /CreditConfirmationDialog/)
  assert.match(listboardClient, /api\/market\/purchases\/batch/)
  assert.match(listboardClient, /status === 401/)
  assert.match(listboardClient, /status === 402/)
  assert.match(listboardClient, /status === 409/)
  assert.match(listboardClient, /status >= 500/)
})
