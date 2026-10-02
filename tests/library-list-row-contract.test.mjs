import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/library-list-row-plan.md 4절: 자료 보관함 한 줄 행(썸네일 + 상품명 + 버튼)
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const view = read('../src/app/(solvook)/library/_components/library-view.tsx')
const page = read('../src/app/(solvook)/library/page.tsx')
const server = read('../src/lib/market-items-server.ts')
const listRow = read('../src/components/market/market-item-list-row.tsx')
// 폐기한 샘플 표지 식별자(7절 D9). src·tests grep 0건 확인에 이 파일이 걸리지 않도록 조각으로 만든다.
const REMOVED_COVER = new RegExp(['attachMarketLibrary' + 'CoverUrls', 'cover' + 'Url', 'LIBRARY_COVER' + '_SIGNED'].join('|'))

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
  const cover = rowBlock.indexOf('<LibraryCover src={row.thumbnailUrl} />')
  const title = rowBlock.indexOf('title={row.title}')
  const buttons = rowBlock.indexOf('환불 신청')
  assert.ok(cover !== -1 && cover < title && title < buttons, 'cover → title → buttons')
  assert.match(rowBlock, /line-clamp-2 sm:line-clamp-1/)
  assert.match(rowBlock, /<li key=\{row\.itemId\} className="flex flex-wrap items-center[^"]*sm:flex-nowrap/)
  assert.match(rowBlock, /sm:max-w-\[55%\]/)

})

test('cover follows the market list row rule: thumbnail image or the same dashed placeholder', () => {
  const coverComponent = view.slice(view.indexOf('function LibraryCover('), view.indexOf('export function LibraryView'))
  assert.match(coverComponent, /\/\/ eslint-disable-next-line @next\/next\/no-img-element -- 어드민이 등록한 외부 썸네일 URL/)
  assert.match(coverComponent, /<img\s+src=\{src\}\s+alt=""\s+loading="lazy"\s+onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(coverComponent, /h-16 w-12 shrink-0 rounded-\[var\(--studio-radius-control\)\] border border-\[var\(--studio-border\)\] object-contain/)
  // 목록 행과 같은 플레이스홀더 토큰(크기만 보관함 행에 맞춤)
  const placeholder = 'items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]'
  assert.ok(listRow.includes(placeholder), 'list row placeholder tokens')
  assert.ok(coverComponent.includes(placeholder), 'library placeholder uses the same tokens')
  assert.match(coverComponent, /<FileImage aria-hidden="true" className="h-5 w-5" \/>/)
  assert.doesNotMatch(view, /object-top|signedUrl/)
  assert.doesNotMatch(view, REMOVED_COVER)
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

test('library rows carry thumbnailUrl from the already-loaded item without sample-page lookups', () => {
  assert.match(server, /export interface MarketLibraryRow \{[\s\S]+?thumbnailUrl: string \| null[\s\S]+?\n\}/)
  // listMarketLibraryRowsForUser는 파일의 마지막 export라 본문을 파일 끝까지 자른다
  const fn = server.slice(server.indexOf('export async function listMarketLibraryRowsForUser('))
  assert.ok(fn.length > 0)
  assert.doesNotMatch(fn, /\nexport /, 'listMarketLibraryRowsForUser is the last export')
  assert.match(fn, /thumbnailUrl: item \? toMarketThumbnailUrl\(supabase, item\) : null,/)
  assert.doesNotMatch(fn, /market_item_sample_pages|createSignedUrl/)
  assert.doesNotMatch(server, REMOVED_COVER)
  assert.doesNotMatch(page, REMOVED_COVER)
  assert.match(page, /const rows = await listMarketLibraryRowsForUser\(userId, subject\)/)
})
