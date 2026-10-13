import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const server = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

function functionBody(name) {
  const start = server.indexOf(`export async function ${name}(`)
  assert.notEqual(start, -1, name)
  const end = server.indexOf('\nexport ', start + 1)
  return server.slice(start, end === -1 ? undefined : end)
}

// 상품 상세는 DB(원격)를 차례로 오가는 횟수를 줄이려고, 앞 결과가 필요 없는 조회를 한 번에 보낸다.
test('서브상품 요약은 서브상품·분류·파일·소유권·파일 유형을 한 번에 읽는다', () => {
  const body = functionBody('listMarketSubproductPublicSummaries')
  assert.equal((body.match(/await /g) ?? []).length, 1)
  assert.match(body, /\] = await Promise\.all\(\[\n\s+subproductQuery,/)
  // 파일은 상품 단위로 읽는다(서브상품 id 목록을 기다리지 않는다)
  assert.match(body, /\.from\('market_subproduct_files'\)\n\s+\.select\('id, subproduct_id, file_type_id, original_file_name'\)\n\s+\.eq\('item_id', itemId\)/)
})

test('전체구매 요약은 묶음 옵션과 소유 여부를 함께 읽는다', () => {
  const body = functionBody('getMarketBundlePublicSummary')
  assert.equal((body.match(/await /g) ?? []).length, 1)
  assert.match(body, /\] = await Promise\.all\(\[\n\s+bundleQuery,/)
})

test('구매자 다운로드 목록은 2단계(소유권·상품 → 파일·서브상품·유형·분류)로 읽는다', () => {
  const body = functionBody('listMarketSubproductDownloadFilesForUser')
  assert.equal((body.match(/await /g) ?? []).length, 2)
  assert.match(body, /const \[entitlements, item\] = await Promise\.all\(\[/)
  assert.match(body, /const \[fileResult, subproductResult, fileTypeResult, categoryResult\] = await Promise\.all\(\[/)
  assert.doesNotMatch(body, /listMarketSubproductFilesForAdmin/)
  // 다운로드 가능 판정은 그대로 소유 범위(item·subproduct·file)를 따른다
  assert.match(body, /entitlement\.scope === 'item' \|\|/)
})
