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

test('market listboard provides sample preview column without the file column', () => {
  assert.match(listboardClient, /MarketSamplePreviewDialog/)
  assert.match(listboardClient, /workspaceSubject/)
  assert.match(listboardClient, /samplePreviewItemId/)
  assert.match(listboardClient, /setSamplePreviewItemId\(itemId\)/)
  assert.match(listboardClient, /openSamplePreview\(row\.itemId\)/)
  assert.match(listboardClient, /row\.sample\.available/)
  assert.match(
    listboardClient,
    /<th className="px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:px-3">자료명<\/th>[\s\S]+<th className="w-\[52px\] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-\[72px\] sm:px-3">샘플<\/th>/
  )
  assert.doesNotMatch(listboardClient, />파일<\/th>/)
  assert.doesNotMatch(listboardClient, /renderAssetOption/)
  assert.doesNotMatch(listboardClient, /AssetKind/)
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

test('market listboard title search handles composed and decomposed Korean text', () => {
  assert.match(marketItemsServer, /return value\?\.normalize\('NFC'\)\.trim\(\) \?\? ''/)
  assert.match(marketItemsServer, /const searchVariants = getNormalizedTextSearchVariants\(filters\.search\)/)
  assert.match(marketItemsServer, /searchVariants\.map\(\(search\) => `title\.ilike\.%\$\{search\}%`\)\.join\(','\)/)
})

test('market listboard hero consumes subject-aware workspace theme classes', () => {
  assert.match(listboardServer, /getWorkspaceSubjectTheme/)
  assert.match(listboardServer, /const subjectTheme = getWorkspaceSubjectTheme\(category\.workspace_subject\)/)
  assert.match(listboardServer, /\$\{subjectTheme\.marketHeroClass\}/)
  assert.match(listboardServer, /\$\{subjectTheme\.marketHeroLabelClass\}/)
  assert.doesNotMatch(listboardServer, /bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800/)
  assert.doesNotMatch(listboardServer, /text-blue-100/)
})

test('market listboard uses the shared compact board UI for every market slug', () => {
  assert.match(listboardClient, /border-t-2 border-slate-950/, 'board should use the strong top divider')
  assert.match(listboardClient, /w-full table-fixed border-collapse text-sm/, 'board should fit columns into the available width')
  assert.match(listboardClient, /w-\[46px\][\s\S]+번호/, 'number column should reserve a compact fixed width')
  assert.match(listboardClient, /w-\[52px\][\s\S]+샘플/, 'sample column should reserve a compact fixed width')
  assert.match(listboardClient, /w-\[58px\][\s\S]+조회/, 'view column should reserve a compact fixed width')
  assert.match(listboardClient, /w-\[88px\][\s\S]+날짜/, 'date column should reserve a compact fixed width')
  assert.doesNotMatch(listboardClient, /min-w-\[1080px\]/, 'board should not force desktop-only horizontal width')
  assert.doesNotMatch(listboardClient, /min-w-\[410px\]/, 'removed file column should not reserve file-column width')
  assert.match(listboardClient, /py-2/, 'rows should use compact vertical padding')
  assert.match(listboardClient, /md:grid-cols-\[1fr_auto_1fr\]/, 'pagination row should center controls with balanced columns')
  assert.match(listboardClient, /justify-self-center/, 'pagination controls should be visually centered')
  assert.doesNotMatch(listboardClient, /formatExamMeta/, 'board rows should not show secondary exam metadata under titles')
  assert.doesNotMatch(listboardClient, /Sparkles/, 'board rows should not show sample badges under titles')
  assert.doesNotMatch(listboardClient, /게시판형 디자인 테스트/, 'production component should not contain preview-only copy')
})

test('market listboard follows board-style alignment and one-line date display', () => {
  assert.match(
    listboardClient,
    /<th className="px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:px-3">자료명<\/th>/,
    'title header should be centered like a board header'
  )
  assert.match(
    listboardClient,
    /<th className="w-\[46px\] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-\[64px\] sm:px-3">번호<\/th>/,
    'number header should stay on one line'
  )
  assert.match(
    listboardClient,
    /<td className="min-w-0 px-2 py-2 sm:px-3">\s*<div className="flex min-w-0 items-center">/,
    'title body should stay left-aligned for readable long titles'
  )
  assert.match(listboardClient, /String\(date\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\)/)
  assert.match(listboardClient, /\$\{year\}\.\$\{month\}\.\$\{day\}/)
  assert.doesNotMatch(listboardClient, /toLocaleDateString\('ko-KR'/)
  assert.match(
    listboardClient,
    /<td className="px-2 py-2 whitespace-nowrap text-center text-slate-600 sm:px-3">\{formatPublishedDate\(row\.publishedAt\)\}<\/td>/,
    'date cell should not wrap at spaces'
  )
})

test('market listboard view column renders only the numeric view count', () => {
  assert.doesNotMatch(listboardClient, /import \{[^}]*Eye[^}]*\} from 'lucide-react'/)
  assert.doesNotMatch(listboardClient, /<Eye className="h-3\.5 w-3\.5 text-slate-400" \/>/)
  assert.match(listboardClient, /\{row\.viewCount\.toLocaleString\(\)\}/)
})

test('market listboard removes direct purchase tray and sends purchase flow to detail page', () => {
  assert.doesNotMatch(listboardClient, /선택 파일 결제/)
  assert.doesNotMatch(listboardClient, /CreditConfirmationDialog/)
  assert.doesNotMatch(listboardClient, /api\/market\/purchases\/batch/)
  assert.doesNotMatch(listboardClient, /status === 402/)
  assert.doesNotMatch(listboardClient, /상세에서 구매/)
  assert.match(listboardClient, /const href = `\/market\/\$\{categorySlug\}\/items\/\$\{row\.itemId\}`/)
  assert.match(listboardClient, /WorkspaceLink/)
})
