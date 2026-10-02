import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/library-list-row-plan.md 4절: 자료 보관함 한 줄 행(썸네일 + 상품명 + 버튼)
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const view = read('../src/app/(solvook)/library/_components/library-view.tsx')
const page = read('../src/app/(solvook)/library/page.tsx')
const legacyPage = read('../src/app/legacy/_library/market/page.tsx')
const server = read('../src/lib/market-items-server.ts')

const rowBlock = view.slice(view.indexOf('{pagedRows.map((row) => {'), view.indexOf('</ul>', view.indexOf('{pagedRows.map((row) => {')))

test('row drops the category badge and the purchase date line but keeps their data uses', () => {
  assert.notEqual(rowBlock, '')
  assert.doesNotMatch(rowBlock, /\{row\.categoryTitle\}/)
  assert.doesNotMatch(rowBlock, /구매일 \{formatDate\(row\.purchasedAt\)\}/)
  assert.doesNotMatch(rowBlock, /최근 다운로드/)
  // 필터·정렬·환불 Dialog는 그대로 쓴다
  assert.match(view, /function formatDate\(/)
  assert.match(view, /구매일 \{formatDate\(target\.purchasedAt\)\}/)
  assert.match(view, /const LIBRARY_FACETS: LibraryFacet\[\] = \[/)
  assert.match(view, /return b\.purchasedAt\.localeCompare\(a\.purchasedAt\)/)
  // 환불 심사 중 배지는 유지한다
  assert.match(rowBlock, /환불 심사 중 \(다운로드 제한\)/)
})

test('row shows the cover first, then a one-line title, then the buttons', () => {
  const cover = rowBlock.indexOf('<LibraryCover src={row.coverUrl} />')
  const title = rowBlock.indexOf('title={row.title}')
  const buttons = rowBlock.indexOf('환불 신청')
  assert.ok(cover !== -1 && cover < title && title < buttons, 'cover → title → buttons')
  assert.match(rowBlock, /line-clamp-2 sm:line-clamp-1/)
  assert.match(rowBlock, /<li key=\{row\.itemId\} className="flex flex-wrap items-center[^"]*sm:flex-nowrap/)
  assert.match(rowBlock, /sm:max-w-\[55%\]/)

  const coverComponent = view.slice(view.indexOf('function LibraryCover('), view.indexOf('export function LibraryView'))
  assert.match(coverComponent, /<img\s+src=\{src\}\s+alt=""\s+loading="lazy"\s+onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(coverComponent, /object-cover object-top/)
  assert.match(coverComponent, /border-dashed[\s\S]*<FileImage aria-hidden="true"/)
})

test('buttons have 44px hit areas and no new color palette is introduced', () => {
  assert.match(view, /const downloadButtonClassName =\s+'inline-flex min-h-11 /)
  assert.match(view, /const refundButtonClassName =\s+'inline-flex min-h-11 /)
  assert.doesNotMatch(view, /#[0-9a-fA-F]{3,8}\b/)
  const allowed = new Set(['bg-black', 'bg-red-500', 'border-red-500', 'ring-red-300', 'text-red-600', 'text-white'])
  const palette = view.match(/\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-[0-9]+)?/g) ?? []
  for (const cls of palette) {
    assert.ok(allowed.has(cls), `unexpected palette class ${cls}`)
  }
})

test('only the /library page attaches cover URLs', () => {
  assert.match(page, /attachMarketLibraryCoverUrls\(await listMarketLibraryRowsForUser\(userId, subject\), subject\)/)
  assert.doesNotMatch(legacyPage, /attachMarketLibraryCoverUrls/)
  assert.match(server, /coverUrl\?: string \| null/)
})

test('cover URL prefers thumbnail_url and falls back to the first active sample page signed URL', () => {
  const fn = server.slice(server.indexOf('export async function attachMarketLibraryCoverUrls'))
  assert.match(fn, /\.from\('market_items'\)\s+\.select\('id, thumbnail_url'\)/)
  assert.match(fn, /\.from\('market_item_sample_pages'\)\s+\.select\('item_id, storage_bucket, storage_path'\)\s+\.in\('item_id', sampleItemIds\)\s+\.eq\('workspace_subject', workspaceSubject\)\s+\.eq\('is_active', true\)\s+\.is\('deleted_at', null\)\s+\.order\('display_order', \{ ascending: true \}\)\s+\.order\('page_number', \{ ascending: true \}\)/)
  assert.match(fn, /\.createSignedUrls\(paths, LIBRARY_COVER_SIGNED_URL_TTL_SECONDS\)/)
  assert.ok(fn.indexOf("from('market_items')") < fn.indexOf("from('market_item_sample_pages')"), 'thumbnail first')
  // R1 N1·N2: 서명 범위·보유자 대상 서명은 의도된 결정으로 주석에 남긴다
  const doc = server.slice(server.lastIndexOf('\n\n', server.indexOf('export async function attachMarketLibraryCoverUrls')), server.indexOf('export async function attachMarketLibraryCoverUrls'))
  assert.match(doc, /클라이언트 slice/)
  assert.match(doc, /서버 페이지네이션/)
  assert.match(doc, /비공개·판매 중지 상품의 샘플도 서명/)
})
