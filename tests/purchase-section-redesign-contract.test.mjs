import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// docs/purchase-section-redesign-plan.md 8절 신규 계약(구매 영역 A안 '딥 잉크')
const itemActions = readFileSync(
  new URL('../src/components/market/market-item-actions.tsx', import.meta.url),
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

test('14절: 패키지는 제목 왼쪽 체크박스(제목 label로 선택), 개별은 Checkbox + aria-label, 막힌 사유는 aria-describedby로 잇는다', () => {
  // 하단 흰 토글 막대 없음
  assert.doesNotMatch(v2, /aria-pressed/)
  // h3 안 label(체크박스 + 추천 + 제목). 부제·가격은 label 밖. 체크박스 이름 '{제목} 선택'은 보이는 제목을 포함(WCAG 2.5.3, 19번 표시명)
  assert.match(v2, /<h3 className="break-keep text-xl font-extrabold">\n[\s\S]{0,120}<label className="[^"]*cursor-pointer[^"]*">\n\s+\{renderOptionSelectControl\(bundleKey, INK_BLOCK_CHECKBOX_CLASS, `\$\{bundleTitle\} 선택`\)\}/)
  // section 이름은 체크박스 이름을 빼고 제목 span만 가리킨다
  assert.match(v2, /aria-labelledby=\{bundleTitleId\}/)
  assert.equal(v2.split('<span id={bundleTitleId} className="break-words [overflow-wrap:anywhere]">{bundleTitle}</span>').length - 1, 2)
  assert.doesNotMatch(v2, /<h3 id=\{bundleTitleId\}/)
  const label = v2.slice(v2.indexOf('<label className="-ml-3'), v2.indexOf('</label>'))
  assert.match(label, />추천<\/span>/)
  assert.ok(label.includes('<span id={bundleTitleId} className="break-words [overflow-wrap:anywhere]">{bundleTitle}</span>'))
  assert.doesNotMatch(label, /bundleSubtitle|priceCredits/)
  // 잉크 위 체크박스: 미체크도 흰 바탕+흰 테두리, 체크 시 흰 바탕+잉크 체크, 흰 포커스 링 + 잉크 offset
  assert.match(itemActions, /const INK_BLOCK_CHECKBOX_CLASS = 'border-\[var\(--studio-surface\)\] bg-\[var\(--studio-surface\)\] text-\[var\(--studio-ink\)\] data-\[state=checked\]:border-\[var\(--studio-surface\)\] data-\[state=checked\]:bg-\[var\(--studio-surface\)\] data-\[state=checked\]:text-\[var\(--studio-ink\)\] focus-visible:border-\[var\(--studio-surface\)\] focus-visible:ring-2 focus-visible:ring-\[var\(--studio-surface\)\] focus-visible:ring-offset-2 focus-visible:ring-offset-\[var\(--studio-ink\)\]'/)
  // 사유는 제목 아래. 선택 시 블록 코랄 링 유지(11번: '잔액 확인 중'·'구매 처리 중' 상태 줄은 상세 바로 구매와 함께 없앴다)
  const reason = v2.indexOf('<p id={getOptionReasonId(bundleKey)}')
  assert.ok(v2.indexOf('</h3>') < reason, 'title → reason')
  assert.match(v2, /\$\{isBundleSelected \? 'ring-2 ring-\[var\(--studio-highlight\)\]' : ''\}/)
  // 보유 시 체크박스 없음(보유 중 태그 + 다운로드)
  assert.match(v2, /\{bundleKey && bundleSelectOption \? \(\n\s+<label/)
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const summaryHintId'))
  assert.match(control, /aria-label=\{ariaLabel \?\? `\$\{option\.title\} 선택`\}/)
  assert.match(control, /aria-describedby=\{reason \? getOptionReasonId\(option\.key\) : undefined\}/)
  assert.match(v2, /<span id=\{getOptionReasonId\(key\)\}/)
  // 그룹 이름은 감싸는 div가 갖고 ul은 목록 역할을 유지한다
  assert.match(v2, /<div role="group" aria-labelledby=\{subproductListTitleId\}>\n\s+<ul className=/)
  assert.doesNotMatch(v2, /<ul role=/)
  // 11번: 구매 상태(잔액 확인·구매 처리) live 영역은 없다
  assert.doesNotMatch(v2, /bundleStatus|renderOptionStatus|잔액 확인 중|구매 처리 중/)
  // 체크박스 테두리는 컨트롤 테두리 토큰으로 보강(비텍스트 대비 3:1)
  assert.match(itemActions, /const renderOptionSelectControl = \(key: string, checkboxClassName = 'border-\[var\(--studio-control-border\)\]', ariaLabel\?: string\) => \{/)
  assert.match(itemActions, /className=\{checkboxClassName\}/)
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

// 19번(2026-11-20 대표 결정): D8 고정 제목을 바꿔 관리자 표시명을 쓰고, 비면 DB 기본 제목(resolveBundleTitle)
test('U2: 패키지 제목은 표시명 규칙(resolveBundleTitle)이고 고정 문구 "전체 패키지"를 쓰지 않는다(19번, D8 바뀜)', () => {
  const heading = v2.slice(v2.indexOf('<h3 className="break-keep text-xl font-extrabold">'), v2.indexOf('</h3>'))
  assert.equal(heading.split('<span id={bundleTitleId} className="break-words [overflow-wrap:anywhere]">{bundleTitle}</span>').length - 1, 2, 'selectable and owned title variants')
  assert.doesNotMatch(heading, /전체 패키지/)
  assert.match(itemActions, /const bundleTitle = resolveBundleTitle\(bundleOption\?\.label, display\) \?\? itemTitle/)
  assert.doesNotMatch(v2, /\{bundleOption\.label/)
})

// 11번(계획 7절): '구매하기'를 없애고 '장바구니 담기' 하나(전체 폭, brand).
test('U2: 하단 바는 "선택 N개 · N 크레딧"과 장바구니 담기 버튼 하나(brand, 전체 폭)', () => {
  assert.match(v2, /선택 <strong[^>]*>\{selectedOptions\.length\}<\/strong>개/)
  assert.match(v2, /<strong[^>]*>\{formatCredits\(selectedTotal\)\}<\/strong> 크레딧/)
  assert.doesNotMatch(v2, /variant="brandOutline"/)
  assert.equal((v2.match(/variant="brand"\n/g) ?? []).length, 1)
  assert.match(v2, /variant="brand"\n\s+className="mt-3 h-auto min-h-11 w-full whitespace-normal"/)
  assert.match(v2, /'장바구니 담기'/)
  assert.doesNotMatch(v2, /구매하기|grid-cols-2/)
})

test('U2: 상태 계산·충돌·담기·구매 함수는 그대로 쓰인다(디자인만 변경)', () => {
  for (const name of ['getBlockedReason', 'addSelectedToCart', 'dedupeQuestionPdfFiles', 'renderDownloadButtons', 'renderOptionSelectControl']) {
    assert.match(v2, new RegExp(`\\b${name}\\(`), name)
  }
  // 11번: 상세 바로 구매(openCheckout)는 없다
  assert.doesNotMatch(itemActions, /openCheckout/)
  // 선택 토글은 개별·패키지 모두 같은 체크박스 컨트롤에서 한다
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const summaryHintId'))
  assert.match(control, /toggleOption\(option\.key, checked === true\)/)
  assert.match(v2, /subproduct\.categorySlug === 'question_pdf' && hasOwnedPdfInclusiveHwp/)
})

const detail = readFileSync(
  new URL('../src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx', import.meta.url),
  'utf8'
)

test('U3: 상세 구매 섹션 머리말은 한글 제목 하나("자료 선택")이고 이동 앵커는 유지된다', () => {
  assert.doesNotMatch(detail, /PURCHASE & DOWNLOAD|PURCHASE OPTIONS|구매 및 다운로드|PackageCheck/)
  // 작은 소제목("구매 옵션")과 안내 문장 머리말은 없앴다(2026-11-19, AI 티 정리)
  assert.doesNotMatch(detail, /">구매 옵션<\/span>|필요한 자료를 선택하세요/)
  assert.match(detail, /id="purchase-options"/)
  assert.match(detail, /aria-labelledby="market-purchase-options-heading"/)
  assert.match(detail, /scroll-mt-36/)
  assert.match(detail, /id="market-purchase-options-heading"[\s\S]{0,120}자료 선택/)
})

const reviewsSection = readFileSync(
  new URL('../src/app/preview/solvook-concept/_components/detail/market-reviews-section.tsx', import.meta.url),
  'utf8'
)

test('15절: 상세 aside 요약 카드와 영문 eyebrow(MATERIAL INFORMATION·REVIEWS)는 없고 두 제목과 좁은 화면 이동 버튼은 남는다', () => {
  assert.doesNotMatch(detail, /aside=\{/)
  assert.doesNotMatch(detail, /구매·다운로드 확인|크레딧부터 이용할 수 있습니다/)
  assert.doesNotMatch(detail, /MATERIAL INFORMATION/)
  assert.doesNotMatch(reviewsSection, /REVIEWS/)
  assert.match(detail, /id="market-material-information-heading"\n\s+className="text-xl font-bold[^"]*"\n\s+>\n\s+자료 상세 정보/)
  assert.match(reviewsSection, /<h2 id="market-reviews-heading" className="text-xl font-bold[^"]*">\n\s+평점 및 후기/)
  assert.match(detail, /<Button asChild variant="brand" className="mt-5 lg:hidden">\n\s+<a href="#purchase-options">구매 옵션 확인<\/a>/)
})

test('U3: 무료 샘플은 배지·장식 카드 없는 한 줄 행이고, 보관함 안내는 토큰 색의 한 줄 글자다', () => {
  const sample = itemActions.slice(itemActions.indexOf('{/* 무료 샘플:'), itemActions.indexOf('{hasV2PurchaseOptions ? renderV2PurchaseOptions()'))
  assert.ok(sample.length > 0)
  assert.doesNotMatch(sample, /<Badge|FileOptionRow|sky-|#[0-9a-fA-F]{3,8}\b/)
  // 19번: 한 줄 행은 공용 부품(MarketSampleRow, 관리자 미리보기도 씀)이 그린다
  const sampleRow = readFileSync(new URL('../src/components/market/market-sample-row.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(sampleRow, /<Badge|FileOptionRow|sky-|#[0-9a-fA-F]{3,8}\b/)
  assert.match(sampleRow, /variant="brandOutline"\n\s+className="min-h-11 shrink-0"/)
  assert.match(sample, /onOpen=\{openSamplePreview\}/)
  // 7번 묶음: 보관함 안내 문장은 DB 문구(purchaseCompleteNotice)
  const noticeStart = itemActions.indexOf('{purchasePolicy ? (\n        <p className="break-keep text-xs')
  assert.ok(noticeStart > 0)
  const notice = itemActions.slice(noticeStart, itemActions.indexOf('<MarketCheckoutConfirmDialog'))
  assert.match(notice, /\{purchasePolicy\.purchaseCompleteNotice\}/)
  assert.doesNotMatch(notice, /slate-|border-dashed/)
})
