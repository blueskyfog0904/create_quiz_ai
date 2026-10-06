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
const bundleSavings = read('../src/lib/market-bundle-savings.ts')

const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/

test('detail adds selected targets to the cart one POST per target, in order', () => {
  assert.match(itemActions, /const addTargetsToCart = async \(\s*options: PurchaseOption\[\],\s*\{ onUnauthorized, onFailure, excludedCount = 0 \}: CartAddHandlers\s*\) => \{[\s\S]+?for \(const option of options\) \{[\s\S]+?fetch\('\/api\/market\/cart\/items', \{\s+method: 'POST'/)
  // 선택 담기 실패는 toast를 유지한다(13절 D22)
  assert.match(itemActions, /await addTargetsToCart\(selectedOptions, \{\s+onUnauthorized: \(\) => redirectToLogin\(\),\s+onFailure: \(message\) => toast\.error\(message\),\s+\}\)/)
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
  // PDF 포함 판정은 src/lib/market-bundle-savings.ts 하나로 옮겼다(구매 영역 개편 U1). 판정 기준은 그대로다.
  assert.match(itemActions, /import \{ getBundleSavings, isPdfInclusiveHwp \} from '@\/lib\/market-bundle-savings'/)
  assert.match(bundleSavings, /subproduct\.categorySlug === 'question_hwp'\s+&& subproduct\.fileTypes\.some\(\(fileType\) => fileType\.code\.toLowerCase\(\) === 'pdf'\)/)
})

test('detail summary uses a two-column brand button pair', () => {
  assert.match(itemActions, /className="mt-3 grid grid-cols-2 gap-2"/)
  assert.match(itemActions, /variant="brandOutline"\s+className="h-auto min-h-11 w-full whitespace-normal"/)
  assert.match(itemActions, /variant="brand"\s+className="h-auto min-h-11 w-full whitespace-normal"/)
  assert.match(itemActions, /선택 <strong[^>]*>\{selectedOptions\.length\}<\/strong>개\n\s+\{' · '\}\n\s+<strong[^>]*>\{formatCredits\(selectedTotal\)\}<\/strong> 크레딧/)
  assert.match(itemActions, /구매하거나 담을 옵션을 선택하세요\./)
})

test('individual rows read checkbox → icon → title, and the bundle toggle sits at the bottom of its block', () => {
  const v2 = itemActions.slice(itemActions.indexOf('const renderV2PurchaseOptions'), itemActions.indexOf('const hasV2PurchaseOptions'))
  // 개별 행: 체크박스(또는 보유 표시) → 형식 아이콘 → 이름 순서
  const rowSelect = v2.indexOf(') : renderOptionSelectControl(key)}')
  const rowIcon = v2.indexOf('{icon}', rowSelect)
  const rowTitle = v2.indexOf('{subproduct.title}</span>', rowIcon)
  assert.ok(rowSelect !== -1 && rowSelect < rowIcon && rowIcon < rowTitle, 'row select before icon before title')
  // 패키지: 제목·가격·포함 목록 아래에 전체 폭 토글 버튼
  const bundleTitle = v2.indexOf('>전체 패키지</h3>')
  const bundleToggle = v2.indexOf('aria-pressed={isBundleSelected}')
  assert.ok(bundleTitle !== -1 && bundleTitle < bundleToggle, 'bundle toggle below the title')
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const renderOptionStatus'))
  assert.match(control, /grid size-11 shrink-0 place-items-center/)
  // 비보유 행은 기본 Button을 만들지 않는다(v1 FileOptionRow 규칙 유지)
  assert.match(itemActions, /\{actionSlot \?\? \(!showDefaultAction \? null : href \? \(/)
})

test('guests can press cart/purchase to log in first and come back to the detail page', () => {
  assert.match(itemActions, /disabled=\{\(isLoggedIn && selectedOptions\.length === 0\) \|\| isBusy\}/)
  assert.match(itemActions, /'로그인 후 담기'/)
  assert.match(itemActions, /'로그인 후 구매'/)
  assert.match(itemActions, /자료를 선택한 뒤 담기·구매하면 로그인 후 이 페이지로 돌아옵니다\./)
  assert.doesNotMatch(itemActions, /담기·구매는 로그인이 필요합니다/)
  // 13절 D21: 비로그인 0건은 로그인으로 보내지 않고 저장도 하지 않으며 인라인 안내만 켠다(두 버튼 같은 규칙)
  for (const [handler, action] of [['const addSelectedToCart = async', 'cart'], ['const openCheckout = async', 'purchase']]) {
    const body = itemActions.slice(itemActions.indexOf(handler))
    const guest = body.slice(body.indexOf('if (!isLoggedIn) {'), body.indexOf('redirectToLogin()') + 'redirectToLogin()'.length)
    assert.match(guest, new RegExp(`if \\(!isLoggedIn\\) \\{[\\s\\S]{0,200}?if \\(selectedOptions\\.length === 0\\) \\{\\s+setEmptyNotice\\(true\\)\\s+return\\s+\\}\\s+saveIntentBeforeLogin\\('${action}'\\)\\s+redirectToLogin\\(\\)$`), handler)
  }
  assert.match(itemActions, /const \[emptyNotice, setEmptyNotice\] = useState\(false\)/)
  assert.match(itemActions, /const toggleOption = \(key: string, checked: boolean\) => \{\s+setEmptyNotice\(false\)/)
  assert.match(itemActions, /<p id=\{`\$\{selectionIdPrefix\}-login`\} aria-live="polite"/)
  assert.match(itemActions, /emptyNotice \? '담을 자료를 먼저 선택하세요\.' : '자료를 선택한 뒤 담기·구매하면 로그인 후 이 페이지로 돌아옵니다\.'/)
})

test('guest selection is saved right before the login redirect and consumed once after login', () => {
  assert.match(itemActions, /import \{ saveMarketCartIntent, takeMarketCartIntent \} from '@\/lib\/market-cart-intent'/)
  assert.match(itemActions, /saveIntentBeforeLogin\('cart'\)\s+redirectToLogin\(\)/)
  assert.match(itemActions, /saveIntentBeforeLogin\('purchase'\)\s+redirectToLogin\(\)/)
  assert.match(itemActions, /const isLoginCompletePending = searchParams\.get\('login'\) === 'success'/)
  assert.match(itemActions, /if \(!intent \|\| !isLoginCompletePending\) \{/)
  // 1회 보장은 ref 가드 + 즉시 삭제(take)로만 한다. cleanup 취소 플래그 금지(StrictMode에서 Dialog가 막힘)
  const effect = itemActions.match(/useEffect\(\(\) => \{\s+if \(!isLoggedIn \|\| cartIntentConsumed\.current\) \{[\s\S]+?\}, \[isLoggedIn\]\)/)
  assert.ok(effect, 'consume effect with ref guard')
  assert.match(effect[0], /cartIntentConsumed\.current = true\s+consumeCartIntent\(\)/)
  assert.doesNotMatch(effect[0], /return \(\) =>|cancelled|canceled/)
  const consume = itemActions.slice(itemActions.indexOf('const consumeCartIntent = useEffectEvent('), itemActions.indexOf('}, [isLoggedIn])'))
  assert.doesNotMatch(consume, /cancelled|canceled/)
  // 구매 자동 실행 금지: 복귀 시 구매는 선택만 복원한다
  assert.doesNotMatch(consume, /openCheckout|submitCheckout|\/purchase|idempotencyKey/)
  assert.match(consume, /if \(intent\.action === 'purchase'\) \{\s+setSelectedKeys\(options\.map\(\(option\) => option\.key\)\)\s+return\s+\}/)
  assert.doesNotMatch(consume, /redirectToLogin/)
  // 13절 D22: 복귀 담기 실패·제외는 toast(로그인 완료 모달에 묻힘) 대신 안내 Dialog로 알린다
  assert.doesNotMatch(consume, /toast\./)
  assert.match(consume, /if \(!option\) \{\s+missingCount \+= 1\s+\} else if \(option\.unavailableReason !== null\) \{\s+preparingCount \+= 1\s+\} else \{\s+options\.push\(option\)/)
  assert.match(consume, /setCartResult\(\{ kind: 'notice', message \}\)/)
  assert.match(consume, /선택했던 자료를 담지 못했습니다\./)
  assert.match(consume, /이미 보유했거나 판매가 중지된 자료 \$\{missingCount\}건/)
  assert.match(consume, /준비 중이라 담을 수 없는 자료 \$\{preparingCount\}건/)
  assert.match(consume, /로그인 상태를 확인하지 못해 담지 못했습니다\. 다시 로그인한 뒤 시도해 주세요\./)
  assert.match(consume, /onFailure: showNotice,\s+excludedCount: missingCount \+ preparingCount,/)
  assert.match(itemActions, /나머지 \$\{excludedCount\}건은 이미 보유했거나 판매 중지·준비 중이라 제외했습니다\./)
  assert.match(itemActions, /setCartResult\(\{\s+kind: 'added',/)
  // 담기 결과 Dialog(성공·안내 공통)는 로그인 완료 Dialog가 닫힌 뒤에 연다
  assert.match(itemActions, /open=\{cartResult !== null && !isLoginCompletePending\}/)
  assert.match(itemActions, /cartResult\?\.kind === 'notice' \? '장바구니 담기 안내' : '장바구니 담기'/)
  assert.match(itemActions, /cartResult\?\.kind === 'notice' \? '확인' : '계속 둘러보기'/)
  assert.doesNotMatch(itemActions, /cartAddedMessage/)
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
