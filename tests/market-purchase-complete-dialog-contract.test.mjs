import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// docs/purchase-complete-dialog-plan.md 4절: 자료 구매 완료 알림을 중앙 Studio Dialog로 통일
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const dialog = read('../src/components/market/market-purchase-complete-dialog.tsx')
const itemActions = read('../src/components/market/market-item-actions.tsx')
// 11번: 장바구니 화면은 껍데기·표시 부품으로 나뉘므로 장바구니 폴더의 파일을 합쳐 본다.
function readTree(dir) {
  const root = new URL(dir, import.meta.url).pathname
  const walk = (path) => statSync(path).isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : /\.(ts|tsx)$/.test(path) ? [readFileSync(path, 'utf8')] : []
  return walk(root).join('\n')
}
const cartView = readTree('../src/app/(solvook)/cart/')
const rootLayout = read('../src/app/layout.tsx')
const sonner = read('../src/components/ui/sonner.tsx')

test('purchase complete dialog lives in components/market with title, description and library link', () => {
  assert.match(dialog, /export function MarketPurchaseCompleteDialog\(/)
  assert.match(dialog, /<StudioDialogTitle[^>]*>구매 완료<\/StudioDialogTitle>/)
  assert.match(dialog, /<StudioDialogDescription/)
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
  // 공통 팝업 틀의 아래 버튼 줄은 flex-col이라 모바일 시각 순서도 DOM과 같다.
  assert.match(dialog, /<StudioDialogFooter>/)
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

// 11번(계획 7절): 자료 구매는 장바구니로만 하므로 구매 완료 창은 장바구니만 그린다(상세에는 없다).
test('the cart renders the shared purchase complete dialog and the detail no longer does', () => {
  assert.match(cartView, /MarketPurchaseCompleteDialog/)
  assert.match(cartView, /from '@\/components\/market\/market-purchase-complete-dialog'/)
  assert.match(cartView, /<MarketPurchaseCompleteDialog[\s\S]{0,200}libraryHref=\{resolveMarketLibraryHref\(/)
  assert.doesNotMatch(itemActions, /MarketPurchaseCompleteDialog|resolveMarketLibraryHref/)
  assert.doesNotMatch(cartView, /toast\.success\(/)
  assert.match(cartView, /toast\.error\(/)
  assert.equal(existsSync(new URL('../src/app/(dashboard)/market/[slug]/market-purchase-complete-dialog.tsx', import.meta.url)), false)
})

test('toaster position stays at its default', () => {
  assert.doesNotMatch(rootLayout, /<Toaster[^>]*position=/)
  assert.doesNotMatch(sonner, /position/)
})
