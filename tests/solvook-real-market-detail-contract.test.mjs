import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), 'utf8')
}

test('Solvook real market detail route loads one published item in its category and subject', async () => {
  const source = await read('src/app/preview/solvook-concept/boards/[slug]/items/[itemId]/page.tsx')

  assert.match(source, /getVisibleMarketMenuEntryBySlugForWorkspace/)
  assert.match(source, /getPublishedMarketItemById/)
  assert.match(source, /resolveWorkspaceSubject/)
  assert.match(source, /item\.menu_entry_id !== category\.id/)
  assert.match(source, /notFound\(\)/)
  assert.match(source, /listActiveMarketItemSamplePages/)
  assert.match(source, /listMarketSubproductPublicSummaries/)
  assert.match(source, /getMarketBundlePublicSummary/)
  assert.match(source, /listCompletedMarketPurchasesForItem/)
  assert.match(source, /listMarketSubproductDownloadFilesForUser/)
})

test('Solvook real market detail renders only real market fields and actions', async () => {
  const source = await read('src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')

  assert.match(source, /StudioDetailPageFrame/)
  assert.match(source, /MarketItemActions/)
  assert.match(source, /MarketMaterialSampleButton/)
  assert.match(source, /item\.title/)
  assert.match(source, /item\.summary/)
  assert.match(source, /item\.description/)
  assert.match(source, /item\.thumbnail_url/)
  assert.match(source, /item\.question_count/)
  assert.match(source, /samplePageCount/)
  assert.doesNotMatch(source, /item\.view_count/)
  assert.doesNotMatch(source, /SampleMaterialPost|sample-data/)
  assert.doesNotMatch(source, /authorLabel|post\.passages|post\.questions/)
  assert.doesNotMatch(source, /합성 지문|합성 문항|합성 콘텐츠/)
})

test('Solvook real market detail keeps a compact title and registration date only in the hero metadata', async () => {
  const source = await read('src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')
  const metadataStart = source.indexOf('<dl className="mt-6')
  const metadataEnd = source.indexOf('</dl>', metadataStart)
  const metadata = source.slice(metadataStart, metadataEnd)

  assert.ok(metadataStart >= 0 && metadataEnd > metadataStart)
  assert.match(source, /<h1 className="mt-5 break-words text-2xl font-extrabold/)
  assert.doesNotMatch(source, /<h1[^>]*text-3xl|<h1[^>]*sm:text-4xl/)
  assert.match(metadata, /CalendarDays/)
  assert.match(metadata, /등록일/)
  assert.doesNotMatch(metadata, /Eye|조회|GraduationCap|과목 및 학년|FileArchive|파일 형식/)
})

test('Solvook material information mirrors the reference label-value grid and hides missing values', async () => {
  const source = await read('src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')

  assert.match(source, /const materialInfoRows = \[/)
  for (const label of ['과목', '학년', '출처', '자료유형', '문항 수', '등록일자']) {
    assert.match(source, new RegExp(`label: '${label}'`))
  }
  assert.doesNotMatch(source, /label: '단원'|label: '제작자'/)
  assert.match(source, /\.filter\(\(row\): row is \{ label: string; value: string \} => Boolean\(row\.value\)\)/)
  assert.match(source, /materialInfoRows\.map\(\(row\)/)
  assert.match(source, /<dt className="min-w-\[72px\] text-\[var\(--studio-muted\)\]">\{row\.label\}<\/dt>/)
  assert.match(source, /description \? \(/)
  assert.doesNotMatch(source, /등록된 상세 설명이 없습니다\.|<dt[^>]*>카테고리<\/dt>|<dt[^>]*>제공 파일<\/dt>/)
})

test('Solvook real market sample button opens the existing real sample dialog without sample fixtures', async () => {
  const source = await read('src/app/preview/solvook-concept/_components/detail/market-material-sample-button.tsx')

  assert.match(source, /MarketSamplePreviewDialog/)
  assert.match(source, /itemId=\{itemId\}/)
  assert.match(source, /workspaceSubject=\{workspaceSubject\}/)
  assert.match(source, /samplePageCount/)
  assert.match(source, /useLoginRedirect/)
  assert.match(source, /if \(!isLoggedIn\)/)
  assert.match(source, /redirectToLogin\(\)/)
  assert.match(source, /returnFocusRef=\{triggerRef\}/)
  assert.doesNotMatch(source, /\bSamplePreviewDialog\b|sample-data/)
})
