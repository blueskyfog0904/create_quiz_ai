import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../src/app/(admin)/admin/market/products/market-products-client.tsx', import.meta.url), 'utf8')
const server = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('목록은 옛 PDF/HWP/ZIP 가격 대신 서브상품·파일·최저가·전체구매·샘플 요약을 보여 준다', () => {
  assert.doesNotMatch(client, /PDF \{item\.pdf_price/)
  assert.match(client, /서브상품 \{summary\.subproductCount\} · 파일 \{summary\.fileCount\}/)
  assert.match(server, /function buildMarketItemAdminListSummary\(row: MarketItemAdminListRow\): MarketItemAdminListSummary/)
  // 판매 중(활성·미삭제)인 서브상품과 파일만 센다
  assert.match(server, /filter\(\(subproduct\) => subproduct\.is_active && !subproduct\.deleted_at\)/)
  assert.match(server, /filter\(\(file\) => file\.is_active && !file\.deleted_at\)/)
  assert.match(client, /summary\.emptySubproductCount > 0 \? `파일 없는 서브상품/)
})

test('상태 탭(개수)과 정렬로 거르고, 업로드하다 멈춘 임시 상품을 표시한다', () => {
  assert.match(client, /const MARKET_LIST_STATUS_TABS = \['all', 'published', 'draft', 'hidden', 'archived'\] as const/)
  assert.match(client, /role="tablist" aria-label="상품 상태"/)
  assert.match(client, /statusCounts\[tab\]/)
  assert.match(client, /const isAbandonedUpload = status === 'draft' && item\.draft_source === 'auto_upload'/)
  assert.match(client, /업로드 중단/)
  assert.match(client, /<option value="updated">최근 수정순<\/option>/)
  // 날짜는 시간대를 고정해 서버·브라우저 표시가 같다
  assert.match(client, /timeZone: 'Asia\/Seoul'/)
})

test('행은 [수정]과 더보기 메뉴(상세 보기·숨김 전환·삭제), 일괄 작업은 선택했을 때만 보인다', () => {
  assert.match(client, /aria-label=\{`\$\{item\.title\} 더보기`\}/)
  assert.match(client, /상세 페이지 보기/)
  assert.match(client, /\{status === 'published' \|\| isHidden \? \(\n\s+<DropdownMenuItem/)
  assert.match(client, /\{selectedItems\.length > 0 \? \(\n\s+<div className="mb-3 flex flex-wrap items-center gap-2/)
  assert.match(client, /onClick=\{\(\) => setSelectedItemIds\(\[\]\)\}>\n\s+선택 해제/)
})
