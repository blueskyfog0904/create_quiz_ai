import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 샘플 이미지는 비공개 저장소의 서명 주소로 내준다. 요청마다 새 주소를 만들면 CDN·브라우저 캐시가 듣지 않아
// 매번 원본에서 받게 되므로, 서명 주소를 공유 캐시로 재사용하고 관리자가 샘플을 바꾸면 바로 새로 만든다.
test('공개 샘플 API는 공개 상품 확인 뒤 서명 주소를 공유 캐시로 읽는다', () => {
  const route = read('src/app/api/market/items/[itemId]/sample-pages/route.ts')
  const itemCheck = route.indexOf('await getPublishedMarketItemById(itemId, workspaceSubject)')
  const cacheRead = route.indexOf('await getCachedPublicMarketSamplePages(itemId, workspaceSubject, buildPublicSamplePages)')
  assert.ok(itemCheck !== -1 && cacheRead > itemCheck, '공개 상품일 때만 주소를 만든다')

  const cache = read('src/lib/market-sample-pages-cache.ts')
  assert.match(cache, /\['public-market-sample-pages', itemId, workspaceSubject\]/)
  assert.match(cache, /revalidate: PUBLIC_SAMPLE_PAGES_CACHE_SECONDS, tags: \[getMarketSamplePagesCacheTag\(itemId\)\]/)
  assert.match(cache, /PUBLIC_SAMPLE_PAGES_CACHE_SECONDS = 60 \* 60/)
  // 만료가 가까운 캐시 주소는 쓰지 않고 새로 만든다
  assert.match(cache, /new Date\(cached\.expiresAt\)\.getTime\(\) - Date\.now\(\) > MIN_REMAINING_SIGNED_URL_MS/)
})

test('관리자가 샘플을 확정·삭제·순서 변경하면 그 상품의 공개 샘플 캐시를 바로 지운다', () => {
  for (const path of [
    'src/app/api/admin/market/items/[id]/samples/commit/route.ts',
    'src/app/api/admin/market/items/[id]/sample-pages/route.ts',
    'src/app/api/admin/market/items/[id]/sample-pages/[pageId]/route.ts',
  ]) {
    assert.match(read(path), /revalidateTag\(getMarketSamplePagesCacheTag\(item\.id\), \{ expire: 0 \}\)/, path)
  }
})

test('샘플 보기 버튼에 올리면 목록과 함께 처음 이미지 2장도 미리 받는다', () => {
  const dialog = read('src/components/market/market-sample-preview-dialog.tsx')
  assert.match(dialog, /PRELOAD_SAMPLE_IMAGE_COUNT = 2/)
  assert.match(dialog, /if \(silent\) preloadSampleImages\(cached\.pages\)/)
  assert.match(dialog, /if \(silent\) preloadSampleImages\(nextPages\)/)
})
