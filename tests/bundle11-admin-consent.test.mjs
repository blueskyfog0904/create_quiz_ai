import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

// 11번 묶음 9절·11-1: 관리자 문구 편집(접는 동의 2판 키·장바구니 문구·작업 기록·미리보기).
const admin = await import('../src/lib/checkout-consent-admin.ts')
const consent = await import('../src/lib/checkout-consent.ts')
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const marketAction = read('src/app/(admin)/admin/footer/purchase-policy-actions.ts')
const marketForm = read('src/app/(admin)/admin/footer/purchase-policy-form.tsx')
const chargeAction = read('src/app/(admin)/admin/pricing/actions.ts')
const chargeForm = read('src/app/(admin)/admin/pricing/point-charge-policy-form.tsx')
const preview = read('src/components/admin/checkout-consent-admin-preview.tsx')
const editor = read('src/components/admin/checkout-consent-editor.tsx')
const marketServer = read('src/lib/market-purchase-policy-server.ts')
const chargeServer = read('src/lib/point-charge-policy-server.ts')

test('입력 정리: 정해진 2판 키만 남기고 consentFormat·모르는 키는 버린다', () => {
  const normalized = admin.normalizeCheckoutConsentKeysInput('market', {
    consentFormat: 2,
    consentTitle: ' 제목\r\n ',
    consentSummary: { refundPeriod: ' a ', restriction: 'b', other: 'x', minor: 'y' },
    consentItems: [{ key: 'k', label: ' 이름 ', view: 'text', textKeys: ['confirmNotice', 3], extra: 1 }, { key: 'l', label: 'L', view: 'link', link: 'serviceTerms' }],
    version: 9,
  })
  assert.deepEqual(normalized, {
    consentTitle: '제목',
    consentSummary: { refundPeriod: 'a', restriction: 'b' },
    consentItems: [{ key: 'k', label: '이름', view: 'text', textKeys: ['confirmNotice'] }, { key: 'l', label: 'L', view: 'link', link: 'serviceTerms' }],
  })
  assert.equal(Object.hasOwn(normalized, 'consentFormat'), false)
  // 한 줄 칸 줄바꿈은 지우지 않고 검사가 거절한다(4-3 (S1))
  assert.equal(admin.normalizeCheckoutConsentKeysInput('market', { consentTitle: '가\n나' }).consentTitle, '가\n나')
  assert.equal(admin.pickCheckoutConsentKeys('market', { checkboxLabel: 'x' }), null)
  assert.equal(admin.pickMarketCartTexts({ checkboxLabel: 'x' }), null)
})

test('새 항목 key 는 코드가 만들고 기존 key 와 겹치지 않으며 검사 식을 지난다', () => {
  assert.equal(admin.nextCheckoutConsentItemKey(['item1', 'terms']), 'item2')
  assert.match(admin.nextCheckoutConsentItemKey([]), /^[a-z][A-Za-z0-9]{0,29}$/)
})

test('충전 유효기간 문구의 [0-9]+년 은 POINT_CHARGE_VALIDITY_YEARS 와 같아야 저장', () => {
  assert.equal(admin.checkPointChargeValidityYears('결제한 때부터 1년 동안 쓸 수 있고'), null)
  assert.match(admin.checkPointChargeValidityYears('결제한 때부터 2년 동안'), /실제 유효기간\(1년\)/)
  assert.equal(admin.checkPointChargeValidityYears('기간 제한 없음'), null)
  assert.match(chargeAction, /validatePointChargePolicyTexts\(texts\) \?\? checkPointChargeValidityYears\(texts\.checkoutItems\.validity\)/)
})

test('지문에 드는 칸: 그때 판과 consentItems 로 계산하고, 장바구니 문구는 늘 지문 밖', () => {
  const v1 = admin.checkoutConsentFingerprintFields('market', 1, {})
  assert.deepEqual([...v1].sort(), ['checkboxLabel', 'confirmNotice'])
  const value = { consentItems: [{ key: 'a', label: 'x', view: 'text', textKeys: ['confirmNotice', 'usageScopeNotice'] }] }
  const v2 = admin.checkoutConsentFingerprintFields('market', 2, value)
  for (const key of ['consentTitle', 'consentSummary', 'consentItems', 'confirmNotice', 'usageScopeNotice']) assert.ok(v2.has(key), key)
  assert.equal(v2.has('checkboxLabel'), false)
  assert.equal(v2.has('downloadPeriodNotice'), false)
  for (const key of consent.MARKET_CART_TEXT_KEYS) {
    assert.equal(v1.has(key), false)
    assert.equal(v2.has(key), false)
  }
  assert.equal(admin.checkoutConsentFingerprintFields('market', null, value).size, 0)
  const charge1 = admin.checkoutConsentFingerprintFields('point_charge', 1, {})
  assert.ok(charge1.has('agreeLabel') && charge1.has('checkoutItems.refund'))
})

test('작업 기록: 지문에 들지 않는 바뀐 키(장바구니 문구 포함)는 전후 값을 전문 그대로 남긴다', () => {
  const before = { cartCheckoutNotice: '옛 안내', partialOwnedConfirmLabel: '같음', confirmNotice: '본문' }
  const after = { cartCheckoutNotice: '새 안내', partialOwnedConfirmLabel: '같음', confirmNotice: '바뀐 본문' }
  const { changedKeys, changes } = admin.diffPolicyTextKeys(before, after, ['cartCheckoutNotice', 'partialOwnedConfirmLabel', 'confirmNotice'])
  assert.deepEqual(changedKeys, ['cartCheckoutNotice', 'confirmNotice'])
  assert.deepEqual(changes.cartCheckoutNotice, { before: '옛 안내', after: '새 안내' })
  // 서버 액션은 지문에 드는 키를 뺀 변경만 changed_texts 로, 전후 지문·판·편집 번호를 함께 남긴다.
  for (const action of [marketAction, chargeAction]) {
    assert.match(action, /changed_texts: changedTexts as Json/)
    assert.match(action, /consent_format: format/)
    assert.match(action, /version_before: saved\.before(Policy)?\.version/)
    assert.match(action, /notice_sha256_before: /)
    assert.match(action, /notice_sha256_after: /)
    assert.match(action, /\.\.\.\(format === 2 && !current\.linksVisible \? \{ notice_sha256_unavailable: 'link_document' \} : \{\}\)/)
  }
  assert.match(marketAction, /const changedTexts = Object\.fromEntries\(Object\.entries\(changes\)\.filter\(\(\[key\]\) => !\(fingerprintBefore\.has\(key\) && fingerprintAfter\.has\(key\)\)\)\)/)
  assert.match(marketAction, /const allKeys = \[\.\.\.MARKET_PURCHASE_POLICY_TEXT_KEYS, \.\.\.CHECKOUT_CONSENT_KEY_NAMES, \.\.\.MARKET_CART_TEXT_KEYS, \.\.\.MARKET_CART_INSUFFICIENT_KEYS\]/)
  assert.match(marketAction, /action: 'market_purchase_policy_update'/)
  assert.match(chargeAction, /action: 'point_charge_policy_update'/)
})

test('저장 검사: 2판 키가 있으면 판과 관계없이 늘 검사, 장바구니 문구 규칙, 링크 문서 검사((g))는 넣지 않음', () => {
  for (const [action, kind] of [[marketAction, 'market'], [chargeAction, 'point_charge']]) {
    assert.match(action, new RegExp(`if \\(hasCheckoutConsentKeys\\(merged\\)\\) \\{\\s*const problem = summarizeCheckoutConsentProblems\\(checkCheckoutConsentKeys\\('${kind}', merged\\)\\)`))
    assert.doesNotMatch(action, /areCheckoutConsentLinksVisible|isRawFooterPolicyDocumentVisible/)
    assert.doesNotMatch(action, /consentFormat:/)
  }
  assert.match(marketAction, /checkMarketCartTexts\(merged\)/)
  // 검사 규칙은 공용 모듈 그대로: 잘못된 장바구니 문구는 문제로 잡힌다.
  assert.equal(consent.checkMarketCartTexts({ cartCheckoutNotice: '가\n나', partialOwnedConfirmLabel: 'x' }).length, 1)
})

test('저장 함수: 자료도 낙관적 잠금(version 대조 + 1), 판(consentFormat)은 입력으로 받지 않고 원본 값 유지', () => {
  const save = marketServer.slice(marketServer.indexOf('export async function saveMarketPurchasePolicyTexts('))
  assert.match(save, /if \(current\.version !== input\.expectedVersion\) \{/)
  assert.match(save, /const nextVersion = current\.version \+ 1/)
  assert.match(save, /query\.eq\('value->>version', String\(storedVersion\)\)/)
  assert.match(save, /\.eq\('value->>refundDays', String\(current\.refundDays\)\)/)
  assert.match(save, /if \(Object\.hasOwn\(before, 'consentFormat'\)\) after\.consentFormat = before\.consentFormat\s*else delete after\.consentFormat/)
  assert.match(save, /revalidateTag\(MARKET_PURCHASE_POLICY_SETTING_KEY, \{ expire: 0 \}\)/)
  const chargeSave = chargeServer.slice(chargeServer.indexOf('export async function savePointChargePolicyTexts('))
  assert.match(chargeSave, /if \(Object\.hasOwn\(beforeRaw, 'consentFormat'\)\) nextValue\.consentFormat = beforeRaw\.consentFormat\s*else delete nextValue\.consentFormat/)
  assert.match(marketForm, /expectedVersion: saved\.policy\.version/)
})

test('미리보기: 실제 CheckoutConsent·장바구니 아래 묶음 부품을 그리고, 장바구니와 같은 판정 함수로 1366×768 을 잰다', () => {
  assert.match(preview, /import \{ CheckoutConsent, type CheckoutConsentLinks \} from '@\/components\/checkout\/checkout-consent'/)
  assert.match(preview, /import \{ CartCheckoutPanelBottom \} from '@\/components\/checkout\/cart-checkout-panel-bottom'/)
  assert.match(preview, /import \{ MarketLegacyConsent \} from '@\/components\/checkout\/market-legacy-consent'/)
  assert.match(preview, /decideCheckoutPanelMode\(\{\s*bottomHeight: ref\.current\.getBoundingClientRect\(\)\.height \+ CHECKOUT_PANEL_PREVIEW_MARGIN,\s*maxInnerHeight: checkoutPanelMaxInnerHeight\(LAPTOP_PREVIEW_VIEWPORT\.height\),/)
  assert.match(preview, /document\.fonts\?\.ready\.then\(measure\)/)
  assert.match(preview, /studio-theme/)
  assert.match(preview, /\[--consent-ink:var\(--ck-ink\)\]/)
  // 판과 관계없이 1판 묶음을 늘 재고(되돌림이 1판을 다시 띄움), 2판 키가 있으면 2판도 잰다. 넘치면 저장을 막는다.
  assert.match(marketForm, /const fitBlocked = fit\.legacy === false \|\| fit\.consent === false/)
  assert.match(marketForm, /legacyNotice=\{previewLegacy\}\s*consent=\{previewConsent\}/)
  assert.match(marketForm, /\{CHECKOUT_PANEL_OVERFLOW_MESSAGE\}/)
  assert.equal(admin.CHECKOUT_PANEL_OVERFLOW_MESSAGE, '1366×768 노트북 결제 칸에 동의와 결제 버튼이 함께 들어가지 않습니다.')
})

test('화면: 동의 방식 읽기 전용 표시, 2판 키 없으면 안내, 되돌리기용 접기, 저장된 값의 지문 보기', () => {
  assert.equal(admin.describeCheckoutConsentFormat(1), '펼친 고지(예전 방식)')
  assert.equal(admin.describeCheckoutConsentFormat(2), '접는 동의(새 방식)')
  for (const form of [marketForm, chargeForm]) {
    assert.match(form, /describeCheckoutConsentFormat\((saved|admin)\.storedFormat\)/)
    assert.match(form, /새 방식 문구가 아직 없습니다\./)
    assert.match(form, /되돌리기용\(예전 방식에만 쓰는 칸\)/)
    assert.match(form, /<StoredCheckoutConsentFingerprint/)
    assert.doesNotMatch(form, /1판|2판/)
  }
  assert.match(marketForm, /장바구니 결제 칸, 상품 상세 &quot;구매 전 확인&quot;/)
  assert.match(read('src/lib/market-purchase-policy.ts'), /purchaseCompleteNotice: '상품 상세 담기 버튼 아래 안내'/)
  assert.match(preview, /navigator\.clipboard\?\.writeText/)
})

test('편집칸: 한 줄 칸은 input, 필수 요약 줄은 삭제 버튼 없음, 항목 최대 6개·다른 항목이 쓴 대상 비활성', () => {
  assert.doesNotMatch(editor, /<Textarea/)
  assert.match(editor, /\{!role\.required \? \(\s*<Button/)
  assert.match(editor, /value\.consentItems\.length < CHECKOUT_CONSENT_ITEMS_MAX/)
  assert.match(editor, /disabled=\{taken\.has\(target\)\}/)
  assert.match(editor, /disabled=\{takenLinks\.has\(link\)\}/)
  assert.match(editor, /key: nextCheckoutConsentItemKey\(/)
  assert.match(editor, /<Counter text=\{value\.consentTitle\} max=\{CHECKOUT_CONSENT_TITLE_MAX\} \/>/)
  assert.match(editor, /<Counter length=\{summaryTotal\} max=\{spec\.summaryTotalMax\} \/>/)
})

// 구현 검증 반영(admin minor 1·2)
test('작업 기록: 저장 전·뒤 지문에 모두 드는 칸만 전문에서 빼고(새로 항목에 넣은 본문은 전후 전문), 항목 모양·키 문제도 편집 화면에 보인다', () => {
  for (const path of ['src/app/(admin)/admin/footer/purchase-policy-actions.ts', 'src/app/(admin)/admin/pricing/actions.ts']) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /const fingerprintBefore = checkoutConsentFingerprintFields\(/, path)
    assert.match(source, /const fingerprintAfter = checkoutConsentFingerprintFields\(/, path)
  }
  const editor = readFileSync(new URL('../src/components/admin/checkout-consent-editor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /\|\| \/\^consentItems\\\.\\d\+\(\\\.key\)\?\$\/\.test\(problem\.field\)/)
})

test('잔액 부족 충전 안내·두 버튼 이름: 관리자 폼에서 한 줄로 고치고(지문 밖), 저장 검사(빈 값·길이)·작업 기록 전문에 든다', () => {
  const form = read('src/app/(admin)/admin/footer/purchase-policy-form.tsx')
  assert.match(form, /MARKET_CART_INSUFFICIENT_KEYS\.map\(\(key\) => \{\n\s+const id = `market-cart-insufficient-\$\{key\}`/)
  assert.match(form, /checkMarketCartInsufficientTexts\(normalizedInsufficient\)/)
  assert.match(form, /cartInsufficientTexts: insufficientDraft,/)
  assert.match(marketAction, /checkMarketCartInsufficientTexts\(cartInsufficientTexts\)/)
  assert.match(marketAction, /MARKET_CART_INSUFFICIENT_KEYS\.map\(\(key\) => \[key, normalizeMarketPurchasePolicyText\(/)
  assert.match(read('src/lib/market-purchase-policy-server.ts'), /\.\.\.\(input\.cartInsufficientTexts \? Object\.fromEntries\(/)
  const lib = read('src/lib/checkout-consent.ts')
  assert.match(lib, /cartChargeButtonLabel: 20,\n\s+cartBalanceRecheckLabel: 20,/)
})
