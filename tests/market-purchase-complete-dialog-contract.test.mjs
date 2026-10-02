import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// docs/purchase-complete-dialog-plan.md 4절: 자료 구매 완료 알림을 중앙 Studio Dialog로 통일
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const dialog = read('../src/components/market/market-purchase-complete-dialog.tsx')
const itemActions = read('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx')
const cartView = read('../src/app/(solvook)/cart/_components/cart-view.tsx')
const rootLayout = read('../src/app/layout.tsx')
const sonner = read('../src/components/ui/sonner.tsx')

test('purchase complete dialog lives in components/market with title, description and library link', () => {
  assert.match(dialog, /export function MarketPurchaseCompleteDialog\(/)
  assert.match(dialog, /<DialogTitle[^>]*>구매 완료<\/DialogTitle>/)
  assert.match(dialog, /<DialogDescription/)
  assert.match(dialog, /건 구매가 완료되었습니다\./)
  assert.match(dialog, /이미 처리된 구매입니다\. 같은 요청이 중복으로 차감되지는 않았습니다\./)
  assert.match(dialog, /<Link href=\{libraryHref\}>자료 보관함에서 받기<\/Link>/)
  assert.match(dialog, /export function resolveMarketLibraryHref\(/)
})

test('purchase complete dialog focuses the close button first and keeps DOM order close → link', () => {
  assert.match(dialog, /showCloseButton=\{false\}/)
  assert.match(dialog, /onOpenAutoFocus=\{\(event\) => \{\s+event\.preventDefault\(\)\s+closeButtonRef\.current\?\.focus\(\)/)
  const closeIndex = dialog.indexOf('계속 둘러보기')
  const linkIndex = dialog.indexOf('자료 보관함에서 받기</Link>')
  assert.ok(closeIndex > 0 && linkIndex > closeIndex)
  assert.match(dialog, /ref=\{closeButtonRef\}/)
  // 모바일 DialogFooter 기본 flex-col-reverse를 덮어 시각 순서도 DOM과 같게 한다.
  assert.match(dialog, /<DialogFooter className="flex-col sm:flex-row">/)
})

test('purchase complete dialog uses Studio tokens only and owns no requests', () => {
  assert.match(dialog, /--studio-/)
  assert.doesNotMatch(dialog, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(dialog, /\b(emerald|slate|gray|green|blue|zinc|neutral)-\d{2,3}\b/)
  assert.doesNotMatch(dialog, /fetch\(/)
  assert.doesNotMatch(dialog, /useRouter/)
})

test('resolveMarketLibraryHref picks the single purchased subject, otherwise /library', async () => {
  // 순수 함수 본문을 그대로 평가해 분기를 확인한다.
  const body = dialog.match(/export function resolveMarketLibraryHref\(subjects: string\[\]\) \{([\s\S]+?)\n\}/)[1]
  const resolve = new Function('subjects', body)
  assert.equal(resolve(['english', 'english']), '/library?subject=english')
  assert.equal(resolve(['korean']), '/library?subject=korean')
  assert.equal(resolve(['english', 'korean']), '/library')
  assert.equal(resolve([]), '/library')
})

test('cart and detail both render the shared purchase complete dialog', () => {
  for (const source of [cartView, itemActions]) {
    assert.match(source, /import \{\s+MarketPurchaseCompleteDialog,\s+resolveMarketLibraryHref,\s+type MarketPurchaseCompleteResult,\s+\} from '@\/components\/market\/market-purchase-complete-dialog'/)
    assert.match(source, /<MarketPurchaseCompleteDialog\s+result=\{purchaseComplete\}\s+libraryHref=\{resolveMarketLibraryHref\(/)
    assert.match(source, /balance: typeof payload\.balance === 'number' \? payload\.balance : null,/)
  }
  assert.doesNotMatch(cartView, /toast\.success\(/)
  assert.match(cartView, /toast\.error\(/)
  assert.equal(existsSync(new URL('../src/app/(dashboard)/market/[slug]/market-purchase-complete-dialog.tsx', import.meta.url)), false)
})

test('toaster position stays at its default', () => {
  assert.doesNotMatch(rootLayout, /<Toaster[^>]*position=/)
  assert.doesNotMatch(sonner, /position/)
})
