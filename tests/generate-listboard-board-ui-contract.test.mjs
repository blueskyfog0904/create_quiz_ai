import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const textbookListboardClient = readFileSync(
  new URL('../src/app/(dashboard)/generate/boards/[slug]/textbook-listboard-client.tsx', import.meta.url),
  'utf8'
)

test('generate listboard table uses the same compact board shell as market listboards', () => {
  assert.match(textbookListboardClient, /overflow-hidden rounded-xl border bg-white/)
  assert.match(textbookListboardClient, /overflow-x-auto sm:overflow-visible/)
  assert.match(textbookListboardClient, /w-full table-fixed border-collapse text-sm/)
  assert.match(textbookListboardClient, /border-t-2 border-slate-950 bg-slate-50 text-slate-700/)
  assert.match(textbookListboardClient, /w-\[46px\][\s\S]+번호/)
  assert.match(textbookListboardClient, /px-2 py-3 text-center text-sm font-bold whitespace-nowrap/)
  assert.match(textbookListboardClient, /border-b border-slate-200 bg-white transition hover:bg-slate-50\/80/)
  assert.match(textbookListboardClient, /px-2 py-2/)
  assert.doesNotMatch(textbookListboardClient, /min-w-full border-collapse text-sm/)
  assert.doesNotMatch(textbookListboardClient, /isStripedRow/)
})

test('generate listboard balances title and metadata column widths', () => {
  assert.match(textbookListboardClient, /<th className="px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:px-3">자료명<\/th>/)
  assert.match(textbookListboardClient, /w-\[74px\][\s\S]+sm:w-\[108px\][\s\S]+년도/)
  assert.match(textbookListboardClient, /w-\[64px\][\s\S]+sm:w-\[92px\][\s\S]+월/)
  assert.match(textbookListboardClient, /w-\[74px\][\s\S]+sm:w-\[108px\][\s\S]+학년/)
  assert.doesNotMatch(textbookListboardClient, /sm:w-\[96px\][\s\S]+년도/)
  assert.doesNotMatch(textbookListboardClient, /sm:w-\[82px\][\s\S]+월/)
  assert.doesNotMatch(textbookListboardClient, /sm:w-\[96px\][\s\S]+학년/)
})

test('generate listboard pagination follows market listboard pagination layout', () => {
  assert.match(textbookListboardClient, /mt-4 space-y-4 pb-\[env\(safe-area-inset-bottom\)\]/)
  assert.match(textbookListboardClient, /md:grid-cols-\[1fr_auto_1fr\]/)
  assert.match(textbookListboardClient, /총 \{posts\.length\}건 · \{visibleCurrentPage\}\/\{totalPages\} 페이지/)
  assert.match(textbookListboardClient, /justify-self-center/)
  assert.match(textbookListboardClient, /aria-label="첫 페이지"[\s\S]+첫 페이지/)
  assert.match(textbookListboardClient, /aria-label="마지막 페이지"[\s\S]+끝 페이지/)
  assert.match(textbookListboardClient, /variant=\{pageNumber === visibleCurrentPage \? 'default' : 'ghost'\}/)
  assert.match(textbookListboardClient, /htmlFor="generate-board-rows-per-page"/)
  assert.match(textbookListboardClient, /id="generate-board-rows-per-page"/)
  assert.doesNotMatch(textbookListboardClient, /ChevronsLeft/)
  assert.doesNotMatch(textbookListboardClient, /ChevronsRight/)
  assert.doesNotMatch(textbookListboardClient, /bg-gray-50\/70/)
})

test('generate listboard numbers start from the oldest visible board post', () => {
  assert.match(
    textbookListboardClient,
    /const rowNumber = posts\.length - \(\(visibleCurrentPage - 1\) \* rowsPerPage \+ index\)/
  )
  assert.doesNotMatch(textbookListboardClient, /const rowNumber = \(visibleCurrentPage - 1\) \* rowsPerPage \+ index \+ 1/)
})
