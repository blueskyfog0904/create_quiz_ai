import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/cart-detail-multiselect-plan.md 7절: 상품 상세 다중 선택 → 일괄 장바구니 담기·바로 구매
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const itemActions = read('../src/components/market/market-item-actions.tsx')
const previewDetail = read('../src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')
// 11번(계획 docs/plan-bundle11-checkout-simplify.md 7절): 상세 바로 구매·확인창이 없어졌다. 장바구니에도 해당하던 단언
// (결제 응답·재시도 키·부족 시 막힘·raw hex 없음)은 tests/bundle11-cart-route-invariants.test.mjs 로 옮겼다.
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

test('detail has no direct purchase: no purchase API, confirmation dialog state or idempotency key', () => {
  assert.doesNotMatch(itemActions, /\/api\/market\/items\/\$\{itemId\}\/purchase/)
  assert.doesNotMatch(itemActions, /setCheckout|submitCheckout|openCheckout|idempotencyKey/)
})
test('detail has no 402 shortfall handling (the cart checkout panel handles insufficient credits)', () => {
  assert.doesNotMatch(itemActions, /response\.status === 402|shortfall/)
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
  // 11번 6-3: 충돌 판정은 장바구니와 같은 공용 함수(DB 결제 6단계와 같은 식). 옵션의 includesPdf 는 'PDF 파일이 있음'(소문자 비교).
  assert.match(itemActions, /import \{ findConflictingSelection, type MarketSelectionLine \} from '@\/lib\/market-selection-conflict'/)
  assert.match(itemActions, /includesPdf: subproduct\.fileTypes\.some\(\(fileType\) => fileType\.code\.toLowerCase\(\) === 'pdf'\)/)
  assert.doesNotMatch(itemActions, /hasSelectedPdfInclusiveHwp|hasSelectedQuestionPdf/)
})

test('detail summary uses one full-width brand cart button', () => {
  assert.doesNotMatch(itemActions, /grid grid-cols-2 gap-2/)
  assert.match(itemActions, /variant="brand"\s+className="mt-3 h-auto min-h-11 w-full whitespace-normal"/)
  assert.match(itemActions, /선택 <strong[^>]*>\{selectedOptions\.length\}<\/strong>개\n\s+\{' · '\}\n\s+<strong[^>]*>\{formatCredits\(selectedTotal\)\}<\/strong> 크레딧/)
  assert.match(itemActions, />담을 옵션을 선택하세요\.</)
  assert.doesNotMatch(itemActions, /구매하거나 담을 옵션을 선택하세요/)
})
test('individual rows read checkbox → icon → title, and the bundle checkbox sits left of the bundle title', () => {
  const v2 = itemActions.slice(itemActions.indexOf('const renderV2PurchaseOptions'), itemActions.indexOf('const hasV2PurchaseOptions'))
  // 개별 행: 체크박스(또는 보유 표시) → 형식 아이콘 → 이름 순서
  const rowSelect = v2.indexOf(') : renderOptionSelectControl(key)}')
  const rowIcon = v2.indexOf('{icon}', rowSelect)
  const rowTitle = v2.indexOf('{subproduct.title}</span>', rowIcon)
  assert.ok(rowSelect !== -1 && rowSelect < rowIcon && rowIcon < rowTitle, 'row select before icon before title')
  // 패키지: 제목(h3) 안에서 체크박스 → 제목 순서(14절)
  const bundleHeading = v2.indexOf('<h3 className="break-keep text-xl font-extrabold">')
  // 19번: 제목은 표시명 규칙(bundleTitle), 체크박스 이름은 '{제목} 선택'
  const bundleSelect = v2.indexOf('renderOptionSelectControl(bundleKey, INK_BLOCK_CHECKBOX_CLASS, `${bundleTitle} 선택`)')
  const bundleTitle = v2.indexOf('<span id={bundleTitleId} className="break-words [overflow-wrap:anywhere]">{bundleTitle}</span>', bundleSelect)
  assert.ok(bundleHeading !== -1 && bundleHeading < bundleSelect && bundleSelect < bundleTitle, 'bundle checkbox before the title text')
  assert.doesNotMatch(v2, /aria-pressed/)
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const summaryHintId'))
  assert.match(control, /grid size-11 shrink-0 place-items-center/)
  // 비보유 행은 기본 Button을 만들지 않는다(v1 FileOptionRow 규칙 유지)
  assert.match(itemActions, /\{actionSlot \?\? \(!showDefaultAction \? null : href \? \(/)
})

test('guests can press cart to log in first and come back to the detail page', () => {
  assert.match(itemActions, /disabled=\{\(isLoggedIn && selectedOptions\.length === 0\) \|\| isBusy\}/)
  assert.match(itemActions, /'로그인 후 담기'/)
  assert.doesNotMatch(itemActions, /로그인 후 구매/)
  assert.match(itemActions, /자료를 선택한 뒤 담기를 누르면 로그인 후 이 페이지로 돌아옵니다\./)
  assert.doesNotMatch(itemActions, /담기·구매/)
  // 13절 D21: 비로그인 0건은 로그인으로 보내지 않고 저장도 하지 않으며 인라인 안내만 켠다
  const body = itemActions.slice(itemActions.indexOf('const addSelectedToCart = async'))
  const guest = body.slice(body.indexOf('if (!isLoggedIn) {'), body.indexOf('redirectToLogin()') + 'redirectToLogin()'.length)
  assert.match(guest, /if \(!isLoggedIn\) \{[\s\S]{0,200}?if \(selectedOptions\.length === 0\) \{\s+setEmptyNotice\(true\)\s+return\s+\}\s+saveIntentBeforeLogin\(\)\s+redirectToLogin\(\)$/)
  assert.match(itemActions, /const \[emptyNotice, setEmptyNotice\] = useState\(false\)/)
  assert.match(itemActions, /const toggleOption = \(key: string, checked: boolean\) => \{\s+setEmptyNotice\(false\)/)
  assert.match(itemActions, /<p id=\{`\$\{selectionIdPrefix\}-login`\} aria-live="polite"/)
  assert.match(itemActions, /emptyNotice \? '담을 자료를 먼저 선택하세요\.' : '자료를 선택한 뒤 담기를 누르면 로그인 후 이 페이지로 돌아옵니다\.'/)
})
test('guest selection is saved right before the login redirect and consumed once after login', () => {
  assert.match(itemActions, /import \{ saveMarketCartIntent, takeMarketCartIntent \} from '@\/lib\/market-cart-intent'/)
  // 11번: 새로 저장하는 의도는 담기뿐이다
  assert.match(itemActions, /saveIntentBeforeLogin\(\)\s+redirectToLogin\(\)/)
  assert.match(itemActions, /saveMarketCartIntent\(\{\s+action: 'cart',/)
  assert.doesNotMatch(itemActions, /saveIntentBeforeLogin\('purchase'\)|action: 'purchase'/)
  assert.match(itemActions, /const isLoginCompletePending = searchParams\.get\('login'\) === 'success'/)
  assert.match(itemActions, /if \(!intent \|\| !isLoginCompletePending\) \{/)
  // 1회 보장은 ref 가드 + 즉시 삭제(take)로만 한다. cleanup 취소 플래그 금지(StrictMode에서 Dialog가 막힘)
  const effect = itemActions.match(/useEffect\(\(\) => \{\s+if \(!isLoggedIn \|\| cartIntentConsumed\.current\) \{[\s\S]+?\}, \[isLoggedIn\]\)/)
  assert.ok(effect, 'consume effect with ref guard')
  assert.match(effect[0], /cartIntentConsumed\.current = true\s+consumeCartIntent\(\)/)
  assert.doesNotMatch(effect[0], /return \(\) =>|cancelled|canceled/)
  const consume = itemActions.slice(itemActions.indexOf('const consumeCartIntent = useEffectEvent('), itemActions.indexOf('}, [isLoggedIn])'))
  assert.doesNotMatch(consume, /cancelled|canceled/)
  // 구매 자동 실행 금지: 배포 전 'purchase' 의도도 담기로 이어간다(결제하지 않음, takeMarketCartIntent 가 바꿔 줌)
  assert.doesNotMatch(consume, /openCheckout|submitCheckout|\/purchase|idempotencyKey/)
  assert.doesNotMatch(consume, /intent\.action === 'purchase'/)
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
  assert.match(previewDetail, /import MarketItemActions from '@\/components\/market\/market-item-actions'/)
  assert.match(previewDetail, /<MarketItemActions/)
})

test('detail no longer uses the checkout confirm dialog', () => {
  assert.doesNotMatch(itemActions, /MarketCheckoutConfirmDialog|market-checkout-confirm-dialog/)
})
test('multiselect UI adds no raw hex colors', () => {
  // 기존 badge·download 상수 외의 줄에는 raw hex가 없어야 한다
  const hexLines = itemActions.split('\n').filter((line) => RAW_HEX.test(line))
  for (const line of hexLines) {
    assert.match(line, /^const MARKET_(BADGE_[A-Z_]+|DOWNLOAD_BUTTON)_CLASS = /)
  }
})
