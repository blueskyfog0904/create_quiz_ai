import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { getMarketDownloadButtonLabel, getMarketDownloadButtonLabels } from '../src/lib/market-download-label.ts'

const itemActions = readFileSync(
  new URL('../src/components/market/market-item-actions.tsx', import.meta.url),
  'utf8'
)
const libraryClient = readFileSync(
  new URL('../src/app/legacy/_library/market/market-library-client.tsx', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)

// 다운로드 버튼 이름 규칙은 상세와 자료 보관함이 함께 쓰는 공용 lib에 있다.
const downloadLabelLib = readFileSync(
  new URL('../src/lib/market-download-label.ts', import.meta.url),
  'utf8'
)
const libraryView = readFileSync(
  new URL('../src/app/(solvook)/library/_components/library-view.tsx', import.meta.url),
  'utf8'
)

test('market detail action panel renders bundle package and individual alternatives before legacy fallback', () => {
  assert.match(itemActions, /subproducts\?: MarketSubproductPublicSummary\[\]/)
  assert.match(itemActions, /bundleOption\?: MarketBundlePublicSummary \| null/)
  assert.match(itemActions, /renderV2PurchaseOptions/)
  assert.match(itemActions, /전체 패키지/)
  assert.match(itemActions, />개별 자료<\/h3>/)
  // 개별 행과 패키지 모두 같은 체크박스 컨트롤로 선택한다(패키지는 제목 왼쪽, 14절).
  assert.match(itemActions, /const key = `subproduct:\$\{subproduct\.id\}`/)
  assert.match(itemActions, /renderOptionSelectControl\(key\)/)
  assert.match(itemActions, /renderOptionSelectControl\(bundleKey, INK_BLOCK_CHECKBOX_CLASS, '전체 패키지 선택'\)/)
  assert.doesNotMatch(itemActions, /aria-pressed=\{isBundleSelected\}/)
  assert.match(itemActions, /clearSelection\(\)/)
  assert.match(itemActions, /targetKind: 'subproduct'/)
  assert.match(itemActions, /targetKind: 'bundle'/)
  assert.doesNotMatch(itemActions, /이 자료만 구매|setPendingV2PurchaseIntent/)
  assert.match(itemActions, /download\?fileId=\$\{fileId\}/)
})

test('market detail action buttons are responsive for sample and purchase actions', () => {
  assert.match(itemActions, /MARKET_ACTION_BUTTON_CLASS/)
  assert.match(itemActions, /w-full/)
  assert.match(itemActions, /sm:w-44/)
  assert.doesNotMatch(itemActions, /MARKET_PRIMARY_BUTTON_CLASS/)
  assert.match(itemActions, /MARKET_OUTLINE_BUTTON_CLASS/)
  assert.match(itemActions, /grid grid-cols-2 gap-2/)
  assert.match(itemActions, /variant="brandOutline"\s+className="h-auto min-h-11 w-full whitespace-normal"/)
  assert.match(itemActions, /variant="brand"\s+className="h-auto min-h-11 w-full whitespace-normal"/)
})

test('market detail uses smart indigo action buttons and file option icons', () => {
  assert.doesNotMatch(itemActions, /bg-indigo-600/)
  assert.match(itemActions, /variant="brand"/)
  assert.match(itemActions, /variant="brandOutline"/)
  assert.match(itemActions, /grid-cols-2/)
  assert.match(itemActions, /border-indigo-500/)
  assert.match(itemActions, /text-indigo-600/)
  assert.match(itemActions, /focus-visible:ring-indigo-300/)
  assert.match(itemActions, /Eye/)
  assert.match(itemActions, /ShoppingCart/)
  assert.match(itemActions, /MarketOptionIcon/)
  assert.match(itemActions, /getSubproductIconKind/)
  assert.doesNotMatch(itemActions, /bg-rose-600/)
})

test('market detail uses soft status badges and green download actions', () => {
  assert.match(itemActions, /MARKET_BADGE_FREE_CLASS/)
  assert.match(itemActions, /MARKET_BADGE_AVAILABLE_CLASS/)
  assert.match(itemActions, /MARKET_BADGE_OWNED_CLASS/)
  assert.match(itemActions, /MARKET_DOWNLOAD_BUTTON_CLASS/)
  assert.match(itemActions, /className=\{MARKET_BADGE_FREE_CLASS\}>무료/)
  assert.match(itemActions, /className=\{MARKET_BADGE_AVAILABLE_CLASS\}>미구매/)
  assert.match(itemActions, /className=\{MARKET_BADGE_OWNED_CLASS\}>구매 완료/)
  assert.match(itemActions, /Download/)
  assert.match(itemActions, /buttonClassName\?: string/)
  assert.match(itemActions, /buttonClassName \?\?/)
  assert.match(itemActions, /className=\{MARKET_DOWNLOAD_BUTTON_CLASS\}/)
  // legacy 행은 보유분 다운로드만 남아 항상 다운로드 버튼 스타일이다 (Phase 2, 구매 410)
  assert.match(itemActions, /\{ownsPdf \? \([\s\S]+?buttonClassName=\{MARKET_DOWNLOAD_BUTTON_CLASS\}/)
  assert.match(itemActions, /\{ownsHwp \? \([\s\S]+?buttonClassName=\{MARKET_DOWNLOAD_BUTTON_CLASS\}/)
  assert.match(itemActions, /\{ownsZip \? \([\s\S]+?buttonClassName=\{MARKET_DOWNLOAD_BUTTON_CLASS\}/)
  assert.match(itemActions, /buildV2DownloadUrl\(itemId, file\.id\)/)
  const downloadClassUses = itemActions.match(/MARKET_DOWNLOAD_BUTTON_CLASS/g) ?? []
  assert.ok(downloadClassUses.length >= 5)
})

test('market detail names v2 download buttons by each file type within the subproduct', () => {
  assert.match(downloadLabelLib, /export function getMarketDownloadButtonLabel\(file: \{ fileTypeLabel: string; subproductTitle: string \}\)/)
  assert.doesNotMatch(downloadLabelLib, /^import /m, 'the shared label rule has no dependencies')
  assert.match(downloadLabelLib, /file\.fileTypeLabel\.trim\(\) \|\| '파일'/)
  assert.match(downloadLabelLib, /const typedTitle = subproductTitle\.replace/)
  assert.match(downloadLabelLib, /`\(\$\{fileTypeLabel\}\)`/)
  assert.match(itemActions, /import \{ getMarketDownloadButtonLabels \} from '@\/lib\/market-download-label'/)
  assert.doesNotMatch(itemActions, /function getMarketDownloadButtonLabel/)
  assert.match(itemActions, /const downloadLabels = getMarketDownloadButtonLabels\(files\)/)
  assert.match(itemActions, /const downloadLabel = downloadLabels\.get\(file\.id\) \?\? ''/)
  assert.match(itemActions, /aria-label=\{`\$\{downloadLabel\} 다운로드`\}/)
  assert.match(itemActions, /\{downloadLabel\}/)
  assert.doesNotMatch(itemActions, /const downloadLabel = `\$\{file\.subproductTitle\} 다운로드`/)
})

test('market detail download buttons do not duplicate an existing file type suffix', () => {
  assert.equal(
    getMarketDownloadButtonLabel({ fileTypeLabel: 'HWP', subproductTitle: '문제(HWP)' }),
    '문제(HWP)'
  )
  assert.equal(
    getMarketDownloadButtonLabel({ fileTypeLabel: 'PDF', subproductTitle: '문제(HWP)' }),
    '문제(PDF)'
  )
  assert.equal(
    getMarketDownloadButtonLabel({ fileTypeLabel: 'PDF', subproductTitle: '문제' }),
    '문제(PDF)'
  )
})

test('market detail resolves v2 subproduct labels from category names first', () => {
  assert.match(marketItemsServer, /function resolveMarketSubproductDisplayTitle/)
  assert.match(marketItemsServer, /resolveMarketSubproductDisplayTitle\(category\?\.name, subproduct\.title\)/)
  assert.match(marketItemsServer, /resolveMarketSubproductDisplayTitle\(categoryMap\.get\(subproduct\.category_id\), subproduct\.title\)/)
})

test('market detail public subproduct DTO includes purchase notice fields', () => {
  assert.match(marketItemsServer, /purchaseNoticeLabel: string \| null/)
  assert.match(marketItemsServer, /purchaseNoticeText: string \| null/)
  assert.match(marketItemsServer, /\.select\('id, item_id, category_id, title, description, purchase_notice_label, purchase_notice_text, price_credits, sort_order'\)/)
  assert.match(marketItemsServer, /purchaseNoticeLabel: subproduct\.purchase_notice_label/)
  assert.match(marketItemsServer, /purchaseNoticeText: subproduct\.purchase_notice_text/)
})

test('market library keeps v2 entitlement data source but sends users to detail for downloads', () => {
  assert.match(marketItemsServer, /market_entitlements/)
  assert.match(marketItemsServer, /v2DownloadFiles/)
  assert.match(marketItemsServer, /listMarketSubproductDownloadFilesForUser/)
  assert.match(itemActions, /buildV2DownloadUrl\(itemId, file\.id\)/)
  assert.doesNotMatch(libraryClient, /file\.downloadUrl/)
  assert.doesNotMatch(libraryClient, /v2OwnedLabels/)
  assert.doesNotMatch(libraryClient, /서브상품\/전체구매/)
})

test('library download buttons share the detail label rule instead of a separate formatter', () => {
  assert.match(libraryView, /import \{ getMarketDownloadButtonLabels \} from '@\/lib\/market-download-label'/)
  assert.match(libraryView, /const downloadLabels = getMarketDownloadButtonLabels\(visibleV2Files\)/)
  assert.doesNotMatch(libraryView, /buildV2DownloadLabel|v2SubproductCount/)
  assert.equal((libraryView.match(/downloadLabels\.get\(file\.id\) \?\? ''/g) ?? []).length, 3, 'v2 link text + aria-label + pending span')
  assert.equal(getMarketDownloadButtonLabel({ fileTypeLabel: 'PDF', subproductTitle: '워크북' }), '워크북(PDF)')
})

test('download buttons show short labels; only <a> links carry an aria-label ending in 다운로드', () => {
  assert.doesNotMatch(downloadLabelLib, / 다운로드`/, 'the shared label no longer appends 다운로드')
  assert.match(libraryView, /aria-label=\{`\$\{downloadLabels\.get\(file\.id\) \?\? ''\} 다운로드`\}/)
  assert.match(libraryView, /aria-label=\{`\$\{entry\.label\} 다운로드`\}/)
  assert.match(libraryView, /\{ key: 'pdf', label: 'PDF', url: row\.pdfDownloadUrl \}/)
  assert.match(libraryView, /\{ key: 'hwp', label: 'HWP', url: row\.hwpDownloadUrl \}/)
  assert.match(libraryView, /\{ key: 'zip', label: 'ZIP', url: row\.zipDownloadUrl \}/)
  assert.doesNotMatch(libraryView, /label: '(PDF|HWP|ZIP) 다운로드'/)
  // 환불 대기 중 비활성 span에는 aria-label을 주지 않는다(role 없는 span의 aria-label은 무시됨).
  for (const span of libraryView.match(/<span key=\{(file\.id|entry\.key)\}[^>]*>/g) ?? []) {
    assert.doesNotMatch(span, /aria-label/)
  }
  assert.equal((libraryView.match(/<span key=\{(file\.id|entry\.key)\}/g) ?? []).length, 2)
})

test('detail and library download files are stably ordered by subproduct category order', () => {
  assert.match(marketItemsServer, /function sortDownloadFilesByCategoryOrder<T extends \{ subproductId: string \}>/)
  assert.match(marketItemsServer, /leftCategory\.sort_order - rightCategory\.sort_order \|\| leftCategory\.name\.localeCompare\(rightCategory\.name, 'ko'\)/)
  assert.equal(
    (marketItemsServer.match(/\.from\('market_subproduct_categories'\)\n\s+\.select\('id, name, slug, sort_order'\)/g) ?? []).length,
    2,
    'detail and library category selects include sort_order',
  )
  assert.match(marketItemsServer, /return sortDownloadFilesByCategoryOrder\(downloadFiles, categoryBySubproductId\)/)
  assert.match(marketItemsServer, /v2DownloadFileMap\.set\(itemId, sortDownloadFilesByCategoryOrder\(itemFiles, categoryBySubproductId\)\)/)
})

test('한 구성에 같은 형식 파일이 여럿이면 버튼 이름에 파일 이름의 다른 부분을 붙여 구분한다', () => {
  const file = (id, originalFileName, fileTypeLabel = 'PDF', subproductTitle = '문제(PDF)') => ({ id, fileTypeLabel, subproductTitle, originalFileName })
  assert.deepEqual([...getMarketDownloadButtonLabels([
    file('a', '창비(이) 6-(2) 의사소통 문화에 참여하는 읽기와 쓰기 기본변형문제.pdf'),
    file('b', '창비(이) 6-(2) 의사소통 문화에 참여하는 읽기와 쓰기 심화변형문제.pdf'),
    file('c', '문제.hwp', 'HWP', '문제(HWP)'),
  ])], [['a', '문제(PDF) · 기본변형문제'], ['b', '문제(PDF) · 심화변형문제'], ['c', '문제(HWP)']])
  // 공통 부분은 단어 중간에서 자르지 않는다
  assert.deepEqual([...getMarketDownloadButtonLabels([file('p', '문제A.pdf'), file('q', '문제B.pdf')])], [['p', '문제(PDF) · 문제A'], ['q', '문제(PDF) · 문제B']])
  // 이름이 같으면 순번
  assert.deepEqual([...getMarketDownloadButtonLabels([file('x', '같은이름.pdf'), file('y', '같은이름.pdf')])], [['x', '문제(PDF) · 1'], ['y', '문제(PDF) · 2']])
})
