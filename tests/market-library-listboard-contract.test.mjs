import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const libraryClient = readFileSync(
  new URL('../src/app/(dashboard)/library/market/market-library-client.tsx', import.meta.url),
  'utf8'
)

test('market library removes asset filter from search controls', () => {
  assert.doesNotMatch(libraryClient, /type AssetFilter/)
  assert.doesNotMatch(libraryClient, /assetFilter/)
  assert.doesNotMatch(libraryClient, /setAssetFilter/)
  assert.doesNotMatch(libraryClient, />PDF 포함</)
  assert.doesNotMatch(libraryClient, />HWP & PDF 포함</)
  assert.doesNotMatch(libraryClient, />ZIP 포함</)
  assert.match(libraryClient, /md:grid-cols-\[minmax\(0,1fr\),180px\]/)
})

test('market library purchase history uses compact board table without status or action columns', () => {
  assert.match(libraryClient, /border-t-2 border-slate-950/)
  assert.match(libraryClient, /w-full table-fixed border-collapse text-sm/)
  assert.match(libraryClient, /hover:bg-slate-50\/80/)
  assert.doesNotMatch(libraryClient, /from '@\/components\/ui\/table'/)
  assert.doesNotMatch(libraryClient, /<Table/)
  assert.doesNotMatch(libraryClient, />구매 상태</)
  assert.doesNotMatch(libraryClient, />액션</)
  assert.doesNotMatch(libraryClient, /PDF 다운로드/)
  assert.doesNotMatch(libraryClient, /HWP 다운로드/)
  assert.doesNotMatch(libraryClient, /ZIP 다운로드/)
  assert.doesNotMatch(libraryClient, /PDF 점검 중/)
  assert.doesNotMatch(libraryClient, /HWP & PDF 점검 중/)
  assert.doesNotMatch(libraryClient, /ZIP 점검 중/)
  assert.doesNotMatch(libraryClient, /pdfDownloadUrl/)
  assert.doesNotMatch(libraryClient, /hwpDownloadUrl/)
  assert.doesNotMatch(libraryClient, /zipDownloadUrl/)
  assert.doesNotMatch(libraryClient, /file\.downloadUrl/)
  assert.doesNotMatch(libraryClient, /v2OwnedLabels/)
  assert.doesNotMatch(libraryClient, />구매 완료</)
  assert.match(
    libraryClient,
    /번호[\s\S]+카테고리[\s\S]+상품 정보[\s\S]+구매일/
  )

  const headerBlock = libraryClient.match(/<thead[\s\S]+?<\/thead>/)?.[0] ?? ''
  assert.equal((headerBlock.match(/<th(?:\s|>)/g) ?? []).length, 4)
  assert.match(headerBlock, /번호[\s\S]+카테고리[\s\S]+상품 정보[\s\S]+구매일/)
  assert.match(libraryClient, /filteredRows\.map\(\(row, index\)/)
})

test('market library purchase history numbers rows from oldest purchase date', () => {
  assert.match(libraryClient, /purchaseOrderByItemId/)
  assert.match(libraryClient, /rows\.slice\(\)\.sort\(\(a, b\) => a\.purchasedAt\.localeCompare\(b\.purchasedAt\)\)/)
  assert.doesNotMatch(libraryClient, /rows\.slice\(\)\.sort\(\(a, b\) => b\.purchasedAt\.localeCompare\(a\.purchasedAt\)\)/)
  assert.match(libraryClient, /purchaseOrderByItemId\.get\(row\.itemId\) \?\? index \+ 1/)
})

test('market library purchase history shows product title only in product info cell', () => {
  assert.match(libraryClient, /\{row\.title\}/)
  assert.doesNotMatch(libraryClient, /row\.summary \? <p/)
})

test('market library rows navigate to subject-aware market item detail', () => {
  assert.match(libraryClient, /`\/market\/\$\{row\.categorySlug\}\/items\/\$\{row\.itemId\}`/)
  assert.match(libraryClient, /WorkspaceLink/)
  assert.match(libraryClient, /subject=\{workspaceSubject\}/)
  assert.match(libraryClient, /withWorkspacePrefix\(workspaceSubject, detailHref\)/)
  assert.match(libraryClient, /role=\{detailHref \? 'link' : undefined\}/)
  assert.match(libraryClient, /tabIndex=\{detailHref \? 0 : undefined\}/)
  assert.match(libraryClient, /event\.key === 'Enter'/)
  assert.match(libraryClient, /event\.key === ' '/)
})

test('market library uses board-style one-line date formatting', () => {
  assert.match(libraryClient, /String\(date\.getMonth\(\) \+ 1\)\.padStart\(2, '0'\)/)
  assert.match(libraryClient, /\$\{year\}\.\$\{month\}\.\$\{day\}/)
  assert.doesNotMatch(libraryClient, /toLocaleDateString\('ko-KR'/)
})
