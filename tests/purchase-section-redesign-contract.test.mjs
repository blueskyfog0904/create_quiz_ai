import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/purchase-section-redesign-plan.md 8절 신규 계약(구매 영역 A안 '딥 잉크')
const itemActions = readFileSync(
  new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
  'utf8'
)
const v2 = itemActions.slice(itemActions.indexOf('const renderV2PurchaseOptions'), itemActions.indexOf('const hasV2PurchaseOptions'))

test('U2: v2 구매 영역은 Studio 토큰만 쓴다(raw hex·tailwind 팔레트 없음, 잉크·코랄 사용)', () => {
  assert.ok(v2.length > 0)
  assert.doesNotMatch(v2, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(v2, /\b(indigo|emerald|cyan|slate|sky)-\d/)
  assert.match(v2, /bg-\[var\(--studio-ink\)\]/)
  assert.match(v2, /var\(--studio-highlight\)/)
  assert.match(itemActions, /const INK_BLOCK_SUBTLE_TEXT_CLASS = 'text-\[color-mix\(in_srgb,var\(--studio-surface\)_72%,transparent\)\]'/)
})

test('13절: 패키지는 블록 안 [패키지 바로 구매](brand)·[장바구니 담기] 버튼, 개별은 Checkbox + aria-label, 사유는 aria-describedby', () => {
  assert.doesNotMatch(v2, /aria-pressed|isBundleSelected|toggleOption\(bundleKey/)
  assert.match(v2, /variant="brand"\n\s+className=\{`h-auto min-h-11 w-full whitespace-normal sm:flex-1 \$\{INK_BLOCK_FOCUS_CLASS\}`\}/)
  assert.match(v2, /onClick=\{\(\) => void buyBundleNow\(\)\}/)
  assert.match(v2, /\$\{isLoggedIn \? '패키지 바로 구매' : '로그인 후 패키지 구매'\} · \$\{formatCredits\(bundleOption\.priceCredits\)\} 크레딧/)
  assert.match(v2, /onClick=\{\(\) => void addBundleToCart\(\)\}/)
  assert.match(v2, /aria-label=\{`전체 패키지 \$\{bundleCartLabel\}`\}/)
  assert.match(v2, /aria-describedby=\{bundleReason \? bundleReasonId : undefined\}/)
  // 640px 미만 세로 쌓기, 두 버튼 44px
  assert.match(v2, /<div className="flex flex-col gap-2 sm:flex-row">/)
  assert.equal((v2.match(/h-auto min-h-11 w-full whitespace-normal/g) ?? []).length >= 2, true)
  // 잉크 위 포커스 링: 흰 링 + 잉크 offset
  assert.match(itemActions, /const INK_BLOCK_FOCUS_CLASS = 'focus-visible:ring-2 focus-visible:ring-\[var\(--studio-surface\)\] focus-visible:ring-offset-2 focus-visible:ring-offset-\[var\(--studio-ink\)\]'/)
  assert.equal((v2.match(/\$\{INK_BLOCK_FOCUS_CLASS\}/g) ?? []).length, 2)
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const renderOptionStatus'))
  assert.match(control, /aria-label=\{`\$\{option\.title\} 선택`\}/)
  assert.match(control, /aria-describedby=\{reason \? getOptionReasonId\(option\.key\) : undefined\}/)
  assert.match(v2, /<span id=\{getOptionReasonId\(key\)\}/)
  // 그룹 이름은 감싸는 div가 갖고 ul은 목록 역할을 유지한다
  assert.match(v2, /<div role="group" aria-labelledby=\{subproductListTitleId\}>\n\s+<ul className=/)
  assert.doesNotMatch(v2, /<ul role=/)
  // 상태 문구 live 영역은 항상 렌더하고 글자만 바꾼다(패키지·행)
  assert.match(v2, /<p aria-live="polite" className=\{`[^`]*`\}>\{bundleStatus\}<\/p>/)
  assert.match(v2, /<span aria-live="polite">\{status \? ` · \$\{status\}` : ''\}<\/span>/)
  assert.doesNotMatch(v2, /\{(bundleStatus|status) \? \(?\s*<[a-z]+ aria-live/)
  // 체크박스 테두리는 컨트롤 테두리 토큰으로 보강(비텍스트 대비 3:1)
  assert.match(itemActions, /className="border-\[var\(--studio-control-border\)\]"/)
  // 잉크 블록 안 빈 파일 안내는 대비 충분한 글자색
  assert.match(v2, /renderDownloadButtons\(dedupeQuestionPdfFiles\(downloadFiles\), INK_BLOCK_SUBTLE_TEXT_CLASS\)/)
  assert.match(v2, /min-h-16/)
})

test('U2: 원가·절약·추천은 getBundleSavings 결과에 묶여 있고 가격 숫자 리터럴이 없다', () => {
  assert.match(itemActions, /import \{ getBundleSavings, isPdfInclusiveHwp \} from '@\/lib\/market-bundle-savings'/)
  assert.match(v2, /const bundleSavings = bundleOption \? getBundleSavings\(bundleOption, subproducts\) : null/)
  assert.match(v2, /\) : bundleSavings \? \(\n\s+<span[^>]*>추천<\/span>/)
  assert.match(v2, /<s>\{formatCredits\(bundleSavings\.comparePriceCredits\)\}<\/s>/)
  assert.match(v2, /<span className="sr-only">개별 구매 시 <\/span>/)
  assert.match(v2, /\{formatCredits\(bundleSavings\.savingsCredits\)\} 크레딧 절약/)
  assert.doesNotMatch(v2, /\b\d{1,3},\d{3}\b|\b\d{4,}\b/, 'no hard-coded credit amounts')
  // 추천 태그는 잉크 글자(D3)
  assert.match(v2, /bg-\[var\(--studio-highlight\)\] px-2 py-0\.5 text-xs font-bold text-\[var\(--studio-ink\)\]">추천/)
})

test('U2: 패키지 제목은 고정 문구 "전체 패키지"이고 관리자 라벨을 제목에 쓰지 않는다(D8)', () => {
  assert.match(v2, /<h3 id=\{bundleTitleId\}[^>]*>전체 패키지<\/h3>/)
  assert.doesNotMatch(v2, /\{bundleOption\.label/)
})

test('U2: 하단 바는 "선택 N개 · N 크레딧"과 장바구니(brandOutline)·구매하기(brand, D3)', () => {
  assert.match(v2, /선택 <strong[^>]*>\{selectedOptions\.length\}<\/strong>개/)
  assert.match(v2, /<strong[^>]*>\{formatCredits\(selectedTotal\)\}<\/strong> 크레딧/)
  assert.match(v2, /variant="brandOutline"/)
  assert.match(v2, /variant="brand"\n/)
})

test('U2: 상태 계산·충돌·담기·구매 함수는 그대로 쓰인다(디자인만 변경)', () => {
  for (const name of ['getBlockedReason', 'addSelectedToCart', 'openCheckout', 'buyBundleNow', 'addBundleToCart', 'dedupeQuestionPdfFiles', 'renderDownloadButtons']) {
    assert.match(v2, new RegExp(`\\b${name}\\(`), name)
  }
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const renderOptionStatus'))
  assert.match(control, /toggleOption\(option\.key, checked === true\)/)
  assert.match(v2, /subproduct\.categorySlug === 'question_pdf' && hasOwnedPdfInclusiveHwp/)
})

const detail = readFileSync(
  new URL('../src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx', import.meta.url),
  'utf8'
)

test('U3: 상세 구매 섹션 머리말과 aside eyebrow는 한글 "구매 옵션"이고 이동 앵커는 유지된다', () => {
  assert.doesNotMatch(detail, /PURCHASE & DOWNLOAD|PURCHASE OPTIONS|구매 및 다운로드|PackageCheck/)
  assert.equal((detail.match(/text-xs font-bold text-\[var\(--studio-muted\)\]">구매 옵션<\/span>/g) ?? []).length, 2)
  assert.match(detail, /id="purchase-options"/)
  assert.match(detail, /aria-labelledby="market-purchase-options-heading"/)
  assert.match(detail, /scroll-mt-36/)
  assert.match(detail, /id="market-purchase-options-heading"[\s\S]{0,120}필요한 자료를 선택하세요/)
})

test('U3: 무료 샘플은 배지·장식 카드 없는 한 줄 행이고, 보관함 안내는 토큰 색의 한 줄 글자다', () => {
  const sample = itemActions.slice(itemActions.indexOf('{/* 무료 샘플:'), itemActions.indexOf('{hasV2PurchaseOptions ? renderV2PurchaseOptions()'))
  assert.ok(sample.length > 0)
  assert.doesNotMatch(sample, /<Badge|FileOptionRow|sky-|#[0-9a-fA-F]{3,8}\b/)
  assert.match(sample, /variant="brandOutline"\n\s+className="min-h-11 shrink-0"/)
  assert.match(sample, /onClick=\{openSamplePreview\}/)
  const notice = itemActions.slice(itemActions.indexOf('구매 후 바로 다운로드할 수 있으며'), itemActions.indexOf('<MarketCheckoutConfirmDialog'))
  assert.match(notice, /자료 보관함/)
  assert.doesNotMatch(notice, /slate-|border-dashed/)
})

const body = (name) => {
  const start = itemActions.indexOf(`const ${name} = async`)
  assert.ok(start > 0, name)
  return itemActions.slice(start, itemActions.indexOf('\n  }\n', start) + 4)
}

test('13절 E1(b): 패키지 버튼은 누르는 즉시 개별 선택을 비우고, 비로그인은 패키지 대상만 저장한 뒤 로그인으로 보낸다', () => {
  for (const [name, action, call] of [
    ['buyBundleNow', 'purchase', 'await startCheckout([bundlePurchaseOption])'],
    ['addBundleToCart', 'cart', 'await addTargetsToCart([bundlePurchaseOption], {'],
  ]) {
    const handler = body(name)
    const clear = handler.indexOf('clearSelection()')
    const guest = handler.indexOf('if (!isLoggedIn) {')
    assert.ok(clear !== -1 && clear < guest, `${name} clears the individual selection first`)
    assert.match(handler, new RegExp(`saveIntentBeforeLogin\\('${action}', \\[bundlePurchaseOption\\]\\)\\s+redirectToLogin\\(\\)`), name)
    assert.ok(handler.includes(call), name)
    assert.match(handler, /setBusyAction\('bundle'\)/)
  }
  assert.match(itemActions, /const saveIntentBeforeLogin = \(action: 'cart' \| 'purchase', options: PurchaseOption\[\] = selectedOptions\) => \{/)
})

test('13절: 하단 바는 개별 자료 전용, busyAction으로 진행 중 버튼만 문구가 바뀐다', () => {
  assert.match(itemActions, /const hasSelectableSubproduct = purchaseOptions\.some\(\(option\) => option\.targetKind === 'subproduct' && option\.unavailableReason === null\)/)
  assert.match(v2, /\{hasSelectableSubproduct \? \(/)
  assert.doesNotMatch(itemActions, /hasSelectableOption/)
  assert.match(itemActions, /const \[busyAction, setBusyAction\] = useState<'bundle' \| 'selection' \| null>\(null\)/)
  assert.match(v2, /isAddingToCart && busyAction !== 'bundle' \? '담는 중' : '장바구니'/)
  assert.match(v2, /isBundleBusy && isCheckingBalance\n\s+\? '확인 중'/)
})

test('13절 E3: 패키지 구매 안내 Dialog는 제목 "패키지 구매 안내"와 확인 버튼 하나만 보인다', () => {
  assert.match(itemActions, /useState<\{ kind: 'added' \| 'notice' \| 'purchase-notice'; message: string \} \| null>/)
  assert.match(itemActions, /cartResult\?\.kind === 'purchase-notice' \? '패키지 구매 안내' : '장바구니 담기'/)
  assert.match(itemActions, /\{cartResult\?\.kind === 'added' \? '계속 둘러보기' : '확인'\}/)
  assert.match(itemActions, /\{cartResult\?\.kind !== 'purchase-notice' \? \(\n\s+<Button asChild variant="brand">\n\s+<Link href="\/cart">장바구니 보기<\/Link>/)
})
