import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { getListPagination } from '../src/lib/list-pagination.ts'

const client = readFileSync(
  new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url),
  'utf8'
)

function body(name) {
  const start = client.indexOf(`const ${name} = `)
  assert.ok(start > 0, name)
  return client.slice(start, client.indexOf('\n  }\n', start) + 4)
}

test('목록은 useListQuery와 getListPagination으로 자른 현재 페이지 조각만 그린다', () => {
  assert.match(client, /import \{ useListQuery \} from '@\/hooks\/use-list-query'/)
  assert.match(client, /import \{ getListPagination \} from '@\/lib\/list-pagination'/)
  assert.match(client, /const listQuery = useListQuery\(\)/)
  assert.match(client, /const listPagination = getListPagination\(filteredItems\.length, listQuery\.page, listQuery\.pageSize\)/)
  assert.match(client, /filteredItems\.slice\(listPagination\.offset, listPagination\.offset \+ listPagination\.pageSize\)/)
  assert.match(client, /pagedItems\.map\(\(item\) => \{/)
  assert.doesNotMatch(client, /filteredItems\.map\(\(item\) => \{/)
})

test('목록 아래 버튼형 StudioListPagination을 두고 링크(getPageHref)나 라우터 이동을 쓰지 않는다', () => {
  assert.match(client, /import \{ StudioListPagination \} from '@\/components\/design-system\/studio-list-pagination'/)
  const usage = client.match(/<StudioListPagination[\s\S]+?\/>/)[0]
  assert.match(usage, /page=\{listPagination\.page\}/)
  assert.match(usage, /pageSize=\{listPagination\.pageSize\}/)
  assert.match(usage, /totalCount=\{filteredItems\.length\}/)
  assert.match(usage, /onPageChange=\{changeListPage\}/)
  assert.match(usage, /onPageSizeChange=\{changeListPageSize\}/)
  assert.doesNotMatch(usage, /getPageHref/)
  for (const handler of ['changeListPage', 'changeListPageSize']) {
    assert.doesNotMatch(body(handler), /router\.(push|replace)\(/, handler)
  }
})

test('머리글 체크박스는 현재 페이지 상품만 선택·해제하고 일괄 작업 대상은 메뉴 전체 선택이다', () => {
  assert.match(client, /aria-label="현재 페이지 상품 전체 선택"/)
  assert.match(client, /const allFilteredSelected = pagedItems\.length > 0 && pagedItems\.every\(\(item\) => selectedItemIds\.includes\(item\.id\)\)/)
  assert.match(client, /const someFilteredSelected = pagedItems\.some\(\(item\) => selectedItemIds\.includes\(item\.id\)\) && !allFilteredSelected/)
  assert.match(body('toggleFilteredSelection'), /const filteredIds = pagedItems\.map\(\(item\) => item\.id\)/)
  assert.match(client, /const selectedItems = useMemo\(\(\) => filteredItems\.filter\(\(item\) => selectedItemIds\.includes\(item\.id\)\)/)
})

test('메뉴 변경은 onChange에서, 저장으로 메뉴가 바뀔 때만 기록 없이(replaceState) 1페이지로 돌리고 useEffect로 초기화하지 않는다', () => {
  assert.match(client, /setSelectedMenuEntryId\(nextMenuEntryId\)\n\s+setSelectedItemIds\(\[\]\)\n\s+listQuery\.update\(\{ page: 1 \}, true\)/)
  assert.match(client, /if \(form\.menuEntryId !== selectedMenuEntryId\) \{\n\s+listQuery\.update\(\{ page: 1 \}, true\)\n\s+\}/)
  assert.equal((client.match(/listQuery\.update\(\{ page: 1 \}, true\)/g) ?? []).length, 2)
  assert.doesNotMatch(client, /listQuery\.setPage\(1\)/)
  for (const effect of client.match(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\)/g) ?? []) {
    assert.doesNotMatch(effect, /setPage|listQuery/, 'page must not be reset inside an effect')
  }
})

test('목록 머리글 스크롤은 페이지·표시 개수 변경 핸들러 안에서만 한다', () => {
  assert.match(client, /<div ref=\{productListHeaderRef\}/)
  assert.match(body('changeListPage'), /listQuery\.setPage\(page\)\n\s+productListHeaderRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\)/)
  assert.match(body('changeListPageSize'), /listQuery\.setPageSize\(size\)\n\s+productListHeaderRef\.current\?\.scrollIntoView\(\{ block: 'start' \}\)/)
  assert.equal((client.match(/scrollIntoView/g) ?? []).length, 2)
})

test('범위를 벗어난 page는 마지막 페이지로 보정되고 표시 개수는 20/50 표준을 따른다', () => {
  assert.deepEqual(getListPagination(146, 9, 20), { totalCount: 146, page: 8, pageSize: 20, totalPages: 8, offset: 140 })
  assert.equal(getListPagination(146, 2, 50).offset, 50)
  assert.equal(getListPagination(146, 1, 999).pageSize, 20)
  assert.equal(getListPagination(0, 3, 20).page, 1)
})
