import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const itemActions = readFileSync(
  new URL('../src/components/market/market-item-actions.tsx', import.meta.url),
  'utf8'
)

test('market item detail separates sample preview from purchase options', () => {
  assert.match(itemActions, /function FileOptionRow/)
  assert.match(itemActions, /무료 샘플/)
  assert.match(itemActions, /무료 샘플 미리보기/)
  assert.match(itemActions, /구매 전 PDF 첫 \$\{samplePageCount\}쪽을 확인할 수 있어요/)
  // 구매 영역 A안: 샘플은 장식 배지 없이 한 줄 행(D4)
  assert.doesNotMatch(itemActions, /구매 전 확인/)
  assert.match(itemActions, /샘플 보기/)
  assert.match(itemActions, /샘플 준비 중/)
  assert.doesNotMatch(itemActions, /PDF 구매하기/)
  assert.doesNotMatch(itemActions, /HWP & PDF 구매하기/)
  // 보관함 안내는 지금 메뉴 이름 "자료 보관함"(D5)
  assert.doesNotMatch(itemActions, /libraryPurchaseLabel|라이브러리 > 구매자료/)
  assert.match(itemActions, /구매한 파일은 <span[^>]*>자료 보관함<\/span>에서도 확인할 수 있습니다\./)
  assert.doesNotMatch(itemActions, /title="샘플 미리보기"[\s\S]*priceLabel="무료"/)
})

test('market item detail presents bundle as a package containing subproducts', () => {
  assert.match(itemActions, /전체 패키지/)
  assert.match(itemActions, /추천/)
  // 구매 영역 A안: 부제는 패키지 설명, 없으면 포함 자료 이름으로 만든다(배지 pill과 고정 설명 문장은 없앴다).
  assert.match(itemActions, /bundleOption\?\.description\n\s+\|\| \(subproducts\.length > 0 \? `\$\{subproducts\.map\(\(subproduct\) => subproduct\.title\)\.join\(' · '\)\} \$\{subproducts\.length\}개 자료를 한 번에`/)
  assert.doesNotMatch(itemActions, /전체 포함|한 번 구매하면 아래 개별 자료/)
  assert.match(itemActions, /subproducts\.map\(\(subproduct\)/)
  assert.match(itemActions, /subproduct\.title/)
  assert.doesNotMatch(itemActions, /전체 패키지 구매/)
  assert.match(itemActions, /구매하기/)
  assert.match(itemActions, /장바구니/)
  assert.match(itemActions, /선택 <strong[^>]*>\{selectedOptions\.length\}<\/strong>개/)
  assert.doesNotMatch(itemActions, /총 금액/)
  assert.match(itemActions, /포함 상품 정보가 아직 표시되지 않습니다\./)
})

test('market item detail shows individual subproducts as lower-emphasis alternatives', () => {
  assert.match(itemActions, /또는 필요한 자료만/)
  assert.match(itemActions, />개별 자료<\/h3>/)
  assert.doesNotMatch(itemActions, /개별 자료 선택 구매|전체 패키지가 필요 없다면 원하는 자료만 구매하세요/)
  assert.match(itemActions, /차액 · 정가 \{formatCredits\(subproduct\.priceCredits\)\} 크레딧/)
  assert.doesNotMatch(itemActions, /이 자료만 구매/)
  assert.match(itemActions, /aria-label=\{ariaLabel \?\? `\$\{option\.title\} 선택`\}/)
  assert.match(itemActions, /패키지 포함/)
})

test('market item detail shows editable purchase notice copy on HWP PDF subproducts', () => {
  assert.match(itemActions, /interface PurchaseNotice/)
  assert.match(itemActions, /DEFAULT_HWP_PDF_NOTICE/)
  assert.match(itemActions, /label: 'PDF 포함'/)
  assert.match(itemActions, /text: '편집 가능한 HWP와 문제\(PDF\)를 함께 제공합니다\. PDF는 따로 구매하지 않아도 됩니다\.'/)
  assert.match(itemActions, /function hasHwpAndPdf\(subproduct: MarketSubproductPublicSummary\)/)
  assert.match(itemActions, /codes\.has\('hwp'\) && codes\.has\('pdf'\)/)
  assert.match(itemActions, /function resolveSubproductPurchaseNotice\(subproduct: MarketSubproductPublicSummary\): PurchaseNotice \| null/)
  assert.match(itemActions, /subproduct\.purchaseNoticeText\?\.trim\(\)/)
  assert.match(itemActions, /subproduct\.purchaseNoticeLabel\?\.trim\(\) \|\| DEFAULT_HWP_PDF_NOTICE\.label/)
  assert.match(itemActions, /notice\?: PurchaseNotice \| null/)
  assert.match(itemActions, /rounded-xl border border-indigo-100 bg-indigo-50\/70/)
  assert.match(itemActions, /\{notice\.label\}/)
  assert.match(itemActions, /\{notice\.text\}/)
  // 개별 행: 형식 부제에 안내 라벨을 덧붙이고 본문은 행 아래 한 줄로 보인다(D7).
  assert.match(itemActions, /const notice = resolveSubproductPurchaseNotice\(subproduct\)/)
  assert.match(itemActions, /\[\.\.\.getVisibleFileTypeLabels\(subproduct, subproducts\), notice\?\.label\]/)
})

test('market item detail shows legacy paid file rows only to existing owners (legacy purchase closed)', () => {
  assert.match(itemActions, /\{ownsPdf \? \(/)
  assert.match(itemActions, /\{ownsHwp \? \(/)
  assert.match(itemActions, /\{ownsZip \? \(/)
  assert.doesNotMatch(itemActions, /\bhas(Pdf|Hwp|Zip)\b/)
  assert.doesNotMatch(itemActions, /openPurchaseConfirmation\(/)
  assert.doesNotMatch(itemActions, /assetKind: pendingPurchaseKind/)
  assert.doesNotMatch(itemActions, /PDF 없음/)
  assert.doesNotMatch(itemActions, /HWP & PDF 없음/)
  assert.doesNotMatch(itemActions, /ZIP 없음/)
  assert.doesNotMatch(itemActions, /priceLabel=\{hasPdf \? `\$\{formatCredits\(pdfPrice\)\} 크레딧` : '미제공'\}/)
  assert.doesNotMatch(itemActions, /priceLabel=\{hasHwp \? `\$\{formatCredits\(hwpPrice\)\} 크레딧` : '미제공'\}/)
  assert.doesNotMatch(itemActions, /priceLabel=\{hasZip \? `\$\{formatCredits\(zipPrice\)\} 크레딧` : '미제공'\}/)
})


test('market item purchase success uses a centered confirmation dialog instead of a toast', () => {
  assert.match(itemActions, /MarketPurchaseCompleteDialog/)
  assert.match(itemActions, /const \[purchaseComplete, setPurchaseComplete\] = useState<MarketPurchaseCompleteResult \| null>\(null\)/)
  assert.match(itemActions, /setPurchaseComplete\(\{\s*orders: payload\.data\?\.orders/)
  assert.match(itemActions, /alreadyCompleted: payload\.alreadyCompleted === true/)
  assert.doesNotMatch(itemActions, /toast\.success\(payload\.message/)
  assert.match(itemActions, /result=\{purchaseComplete\}/)
  assert.match(itemActions, /onClose=\{\(\) => setPurchaseComplete\(null\)\}/)
})

test('market item detail action states and failure messages are explicit', () => {
  assert.match(itemActions, /OptionState = 'instant' \| 'owned' \| 'included' \| 'available' \| 'unavailable' \| 'checking' \| 'processing'/)
  assert.match(itemActions, /status === 401/)
  assert.match(itemActions, /status === 402/)
  assert.match(itemActions, /code === 'PRICE_CHANGED'/)
  assert.match(itemActions, /code === 'ACK_REQUIRED'/)
  assert.match(itemActions, /status >= 500/)
})

test('market item downloads preserve existing paid file API URLs', () => {
  assert.match(itemActions, /\/api\/market\/items\/\$\{itemId\}\/download\?assetKind=\$\{assetKind\}/)
  assert.doesNotMatch(itemActions, /buildDownloadUrl\(itemId, 'sample'\)/)
  assert.match(itemActions, /\/api\/market\/items\/\$\{itemId\}\/purchase/)
})

test('market item sample preview prefetch is available to visitors when samples exist', () => {
  assert.match(itemActions, /onIntent\?: \(\) => void/)
  assert.match(itemActions, /onFocus=\{onIntent\}/)
  assert.match(itemActions, /onMouseEnter=\{onIntent\}/)
  assert.match(itemActions, /onTouchStart=\{onIntent\}/)
  assert.match(itemActions, /const \[samplePreviewPrefetchKey, setSamplePreviewPrefetchKey\] = useState\(0\)/)
  assert.match(itemActions, /const prefetchSamplePreview = \(\) => \{/)
  assert.match(itemActions, /if \(!hasSamplePages\)/)
  assert.doesNotMatch(itemActions, /!isLoggedIn \|\| !hasSamplePages/)
  assert.match(itemActions, /setSamplePreviewPrefetchKey\(\(value\) => value \+ 1\)/)
  // 샘플 한 줄 행의 버튼이 같은 미리 불러오기를 건다
  assert.match(itemActions, /onClick=\{openSamplePreview\}\n\s+onFocus=\{prefetchSamplePreview\}\n\s+onMouseEnter=\{prefetchSamplePreview\}\n\s+onTouchStart=\{prefetchSamplePreview\}/)
  assert.match(itemActions, /prefetchKey=\{samplePreviewPrefetchKey\}/)
})
