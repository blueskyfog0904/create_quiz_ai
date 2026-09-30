import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/cart-detail-multiselect-plan.md 7절: 상품 상세 다중 선택 → 일괄 장바구니 담기·바로 구매
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const itemActions = read('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx')
const dashboardDetailPage = read('../src/app/(dashboard)/market/[slug]/items/[itemId]/page.tsx')
const previewDetail = read('../src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')
const cartView = read('../src/app/(solvook)/cart/_components/cart-view.tsx')
const confirmDialog = read('../src/components/market/market-checkout-confirm-dialog.tsx')

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/

test('detail adds selected targets to the cart one POST per target, in order', () => {
  assert.match(itemActions, /for \(const option of selectedOptions\) \{[\s\S]+?fetch\('\/api\/market\/cart\/items', \{\s+method: 'POST'/)
  assert.match(itemActions, /\? \{ targetKind: 'bundle', bundleOptionId: option\.targetId \}\s+: \{ targetKind: 'subproduct', subproductId: option\.targetId \}/)
  assert.doesNotMatch(itemActions, /\/api\/market\/cart\/items[\s\S]{0,200}body: JSON\.stringify\(\{ (items|targets):/)
  assert.match(itemActions, /payload\.error\?\.code === 'CART_LIMIT'/)
  assert.match(itemActions, /dispatchMarketCartUpdated\(latestCount\)/)
})

test('detail direct purchase sends lines with one idempotency key per confirmation dialog', () => {
  assert.match(itemActions, /setCheckout\(\{\s+idempotencyKey: crypto\.randomUUID\(\),\s+lines: selectedOptions\.map\(/)
  assert.match(itemActions, /fetch\(`\/api\/market\/items\/\$\{itemId\}\/purchase`/)
  assert.match(itemActions, /lines: request\.lines\.map\(\(line\) => \(\{\s+target:/)
  assert.match(itemActions, /idempotencyKey: request\.idempotencyKey,/)
  // 5xx·네트워크 유실은 같은 키, 409 재확인은 새 키
  assert.match(itemActions, /response\.status >= 500\) \{\s+setCheckout\(\{ \.\.\.request, submitting: false, retryable: true/)
  assert.match(itemActions, /code === 'PRICE_CHANGED'[\s\S]+?idempotencyKey: crypto\.randomUUID\(\)/)
  assert.match(itemActions, /if \(code === 'ACK_REQUIRED'\) \{[\s\S]{0,300}?setCheckout\(\{\s+\.\.\.request,\s+idempotencyKey: crypto\.randomUUID\(\),/)
})

test('detail 402 shows the shortfall and disables the confirm button', () => {
  assert.match(itemActions, /if \(response\.status === 402\) \{[\s\S]{0,900}?shortfall: shortfall > 0 \? shortfall : null,/)
  assert.match(itemActions, /shortfall=\{checkout\?\.shortfall \?\? null\}/)
  assert.match(confirmDialog, /const canConfirm = !submitting && shortfall === null/)
  assert.match(confirmDialog, /<Button variant="brand" disabled=\{!canConfirm\} onClick=\{onConfirm\}>/)
})

test('detail drops selections that are no longer selectable when options change', () => {
  assert.match(itemActions, /if \(prunedKeySignature !== selectableKeySignature\) \{[\s\S]{0,200}?setSelectedKeys\(\(current\) => current\.filter\(\(key\) => selectableKeys\.includes\(key\)\)\)/)
})

test('detail shows the three conflict reasons and compares file type codes in lowercase', () => {
  assert.match(itemActions, /전체 패키지에 포함되어 함께 선택할 수 없습니다\. 개별 구매는 전체 패키지 선택을 해제하세요\./)
  assert.match(itemActions, /개별 자료를 선택한 상태에서는 전체 패키지를 함께 선택할 수 없습니다\./)
  assert.match(itemActions, /문제\(HWP\)에 PDF가 포함되어 있어 함께 선택할 수 없습니다\./)
  assert.match(itemActions, /subproduct\.categorySlug === 'question_hwp'\s+&& subproduct\.fileTypes\.some\(\(fileType\) => fileType\.code\.toLowerCase\(\) === 'pdf'\)/)
})

test('detail summary uses a two-column brand button pair', () => {
  assert.match(itemActions, /className="mt-3 grid grid-cols-2 gap-2"/)
  assert.match(itemActions, /variant="brandOutline"\s+className="h-11 w-full"/)
  assert.match(itemActions, /variant="brand"\s+className="h-11 w-full"/)
  assert.match(itemActions, /총 금액/)
  assert.match(itemActions, /구매하거나 담을 옵션을 선택하세요\./)
})

test('both detail routes render the shared MarketItemActions', () => {
  assert.match(dashboardDetailPage, /<MarketItemActions/)
  assert.match(previewDetail, /import MarketItemActions from '@\/app\/\(dashboard\)\/market\/\[slug\]\/items\/\[itemId\]\/market-item-actions'/)
  assert.match(previewDetail, /<MarketItemActions/)
})

test('cart and detail share the checkout confirm dialog', () => {
  for (const source of [cartView, itemActions]) {
    assert.match(source, /import \{ MarketCheckoutConfirmDialog \} from '@\/components\/market\/market-checkout-confirm-dialog'/)
    assert.match(source, /<MarketCheckoutConfirmDialog/)
  }
  assert.match(confirmDialog, /const canConfirm = !submitting && shortfall === null && \(!needsAcknowledgement \|\| acknowledged\)/)
  assert.match(confirmDialog, /if \(!nextOpen && !submitting\) \{\s+onCancel\(\)/)
  assert.match(confirmDialog, /disabled=\{submitting \|\| retryable\}/)
  assert.doesNotMatch(confirmDialog, /fetch\(/)
})

test('multiselect UI adds no raw hex colors', () => {
  assert.doesNotMatch(confirmDialog, RAW_HEX)
  assert.doesNotMatch(cartView, RAW_HEX)
  // 기존 badge·download 상수 외의 줄에는 raw hex가 없어야 한다
  const hexLines = itemActions.split('\n').filter((line) => RAW_HEX.test(line))
  for (const line of hexLines) {
    assert.match(line, /^const MARKET_(BADGE_[A-Z_]+|DOWNLOAD_BUTTON)_CLASS = /)
  }
})
