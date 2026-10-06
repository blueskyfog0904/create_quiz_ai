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

test('U2: 패키지는 aria-pressed 토글 버튼, 개별은 Checkbox + aria-label, 막힌 사유는 aria-describedby로 잇는다', () => {
  assert.match(v2, /<button\n\s+type="button"\n\s+aria-pressed=\{isBundleSelected\}/)
  assert.match(v2, /aria-describedby=\{bundleReason \? getOptionReasonId\(bundleKey\) : undefined\}/)
  // APG 토글 버튼: 보이는 문구는 고정, 상태는 aria-pressed + 체크 아이콘·코랄 링
  assert.doesNotMatch(v2, /전체 패키지 선택됨/)
  assert.match(v2, /\{isBundleSelected \? <Check aria-hidden="true" className="h-4 w-4" \/> : null\}\n\s+전체 패키지 선택\n/)
  assert.match(v2, /\$\{isBundleSelected \? 'ring-2 ring-\[var\(--studio-highlight\)\]' : ''\}/)
  assert.match(v2, /min-h-11 w-full/)
  const control = itemActions.slice(itemActions.indexOf('const renderOptionSelectControl'), itemActions.indexOf('const renderOptionStatus'))
  assert.match(control, /aria-label=\{`\$\{option\.title\} 선택`\}/)
  assert.match(control, /aria-describedby=\{reason \? getOptionReasonId\(option\.key\) : undefined\}/)
  assert.match(v2, /<span id=\{getOptionReasonId\(key\)\}/)
  // 그룹 이름은 감싸는 div가 갖고 ul은 목록 역할을 유지한다
  assert.match(v2, /<div role="group" aria-labelledby=\{subproductListTitleId\}>\n\s+<ul className=/)
  assert.doesNotMatch(v2, /<ul role=/)
  // 상태 문구 live 영역은 항상 렌더하고 글자만 바꾼다(패키지·행)
  assert.match(v2, /<p aria-live="polite" className=\{`[^`]*`\}>\{bundleStatus \?\? ''\}<\/p>/)
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
  for (const name of ['getBlockedReason', 'toggleOption', 'addSelectedToCart', 'openCheckout', 'dedupeQuestionPdfFiles', 'renderDownloadButtons']) {
    assert.match(v2, new RegExp(`\\b${name}\\(`), name)
  }
  assert.match(v2, /subproduct\.categorySlug === 'question_pdf' && hasOwnedPdfInclusiveHwp/)
})
