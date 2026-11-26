import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

// 11번 계획 5-1·4-3·11-1 '지문': 2판 원문·지문·검사 규칙(TS). 같은 예시 묶음을 SQL 리허설(supabase/scripts/bundle11_rehearsal)이 쓴다.
const consent = await import('../src/lib/checkout-consent.ts')
const { POINT_CHARGE_VALIDITY_YEARS, parsePointChargeCheckoutNotice } = await import('../src/lib/point-charge-policy.ts')
const { parseMarketPurchaseNotice } = await import('../src/lib/market-purchase-policy.ts')

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const examples = JSON.parse(read('tests/fixtures/bundle11-consent-examples.json'))
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const valueOf = (c) => {
  const value = { ...examples.bases[c.kind], ...c.patch }
  for (const key of c.remove) delete value[key]
  return value
}

test('5-1 시험 벡터: 충전 D=7·Y=1 원문과 지문 2e53f470…', () => {
  const draft = consent.buildCheckoutConsentDraft('point_charge', examples.bases.point_charge, 7)
  assert.ok(draft)
  const text = consent.buildCheckoutConsentText(draft)
  assert.equal(text, [
    '주문 내용·충전 조건 확인 및 결제 동의',
    '7일째 되는 날까지 신청할 수 있어요.',
    '하나라도 쓰면 취소할 수 없어요.',
    '1년 동안 쓸 수 있어요.',
    '미성년자는 취소할 수 있어요.',
    '충전 상품 안내', '상품 A', '기간 B',
    '취소·환불 안내', '환불 7일', '둘째 줄', '제한 C', '기타 D',
    '미성년자 결제 취소 안내', '미성년 E',
    '취소·환불정책', '링크:refundPolicy',
    '서비스 이용약관', '링크:serviceTerms',
  ].join('\n'))
  assert.ok(!text.endsWith('\n'))
  assert.equal(sha(text), '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7')
  // 묶음에는 1판 키가 없고 key·view 는 원문에 들지 않는다
  assert.deepEqual(Object.keys(draft).sort(), ['consentFormat', 'consentItems', 'consentSummary', 'consentTitle', 'refundDays'])
  assert.doesNotMatch(text, /product|minor|\bview\b|refundPeriod/)
})

test('자료 벡터: note 줄·앞뒤 공백 요약 줄(trim 없음)·LF 로 끝나는 본문·본문 둘인 항목', () => {
  const draft = consent.buildCheckoutConsentDraft('market', examples.bases.market, 30)
  const text = consent.buildCheckoutConsentText(draft)
  assert.ok(text.includes('\n  30일째 되는 날까지 신청할 수 있어요. \n'))
  assert.ok(text.includes('환불 안내 본문 30일\n\n다운로드 본문'))
  assert.equal(draft.consentSummary.length, 3)
  assert.deepEqual(draft.consentItems[0].texts, ['환불 안내 본문 30일\n', '다운로드 본문'])
  assert.equal(sha(text), examples.cases.find((c) => c.name.startsWith('자료 벡터')).noticeSha256)
})

test('예시 묶음: 받음·거절·지문이 정해진 값과 같다(SQL 리허설 FX 와 같은 파일)', () => {
  assert.ok(examples.cases.length >= 40)
  for (const c of examples.cases) {
    const value = valueOf(c)
    const draft = consent.buildCheckoutConsentDraft(c.kind, value, examples.refundDays[c.kind])
    assert.equal(draft !== null, c.ok, c.name)
    assert.equal(consent.checkCheckoutConsentKeys(c.kind, value).length === 0, c.ok, c.name)
    if (c.ok) assert.equal(sha(consent.buildCheckoutConsentText(draft)), c.noticeSha256, c.name)
  }
  // 11-1 이 짚은 거절 예시가 모두 들어 있다
  for (const name of ['30일', '１년', '12개월', '일 년', '한 달', '이틀', 'note: null', '한 줄 칸 LF(제목)', '중괄호', '요약 줄 121자', '객체 textKeys',
    '허용 밖 textKeys(agreeLabel)', '충전 요약 줄 빠짐(minor)', '자료 필수 본문 빠짐(confirmNotice)']) {
    assert.ok(examples.cases.some((c) => c.name.includes(name) && c.ok === false), name)
  }
})

test('장바구니 문구: 지문 = sha256(안내 LF 확인), trim 없음, 규칙 위반은 null', () => {
  for (const c of examples.cartCases) {
    const problems = consent.checkMarketCartTexts(c.value)
    assert.equal(problems.length === 0, c.ok, c.name)
    if (c.ok) {
      assert.equal(sha(consent.buildMarketCartTextsSource(c.value)), c.cartTextsSha256, c.name)
      assert.deepEqual(consent.parseMarketCartTexts({ ...c.value, cartTextsSha256: c.cartTextsSha256 }),
        { cartCheckoutNotice: c.value.cartCheckoutNotice, partialOwnedConfirmLabel: c.value.partialOwnedConfirmLabel, cartTextsSha256: c.cartTextsSha256 })
    }
  }
  assert.equal(sha(' 앞 공백 안내\n뒤 공백 확인 '), examples.cartCases[0].cartTextsSha256)
  assert.equal(consent.parseMarketCartTexts({ ...examples.cartCases[0].value, cartTextsSha256: 'XYZ' }), null)
})

test('판 읽기(4-1): 없거나 1 → 1, 2 → 2, 글자 "2"·2.5·3·null → null(결제 닫힘) — SQL 리허설과 같은 예시', () => {
  for (const c of examples.formatCases) {
    assert.equal(consent.readCheckoutConsentFormat(JSON.parse(c.raw)), c.format, c.name)
  }
  assert.equal(consent.readCheckoutConsentFormat(null), null)
})

test('링크 문서(4-3 (g)): 원본에서 enabled 정확히 true·label·content 비지 않음 — enabled 없으면 닫힘(정규화보다 엄격)', () => {
  const doc = { label: '서비스 이용약관', content: '본문', enabled: true, slug: 'service', title: '이용약관' }
  const footer = (patch = {}) => ({ policyDocuments: { refundPolicy: { ...doc, label: '취소/환불정책' }, serviceTerms: { ...doc, ...patch } } })
  assert.equal(consent.areCheckoutConsentLinksVisible(footer()), true)
  const enabledMissing = footer()
  delete enabledMissing.policyDocuments.serviceTerms.enabled
  for (const bad of [footer({ enabled: false }), enabledMissing, footer({ enabled: 'true' }), footer({ label: ' ' }), footer({ content: '\n\t' }),
    footer({ content: null }), { policyDocuments: { refundPolicy: doc } }, null]) {
    assert.equal(consent.areCheckoutConsentLinksVisible(bad), false)
  }
  assert.doesNotMatch(read('src/lib/checkout-consent.ts'), /getVisibleFooterPolicyLinks\(|inspectRawFooterPolicyDocument\(/)
})

test('화면이 받는 2판 묶음 해석: 1판 해석기는 2판 묶음에 null, 새 해석기는 1판 고지에 null(뷰 칸 나눔 5-2)', () => {
  const draft = consent.buildCheckoutConsentDraft('point_charge', examples.bases.point_charge, 7)
  const bundle = { ...draft, noticeSha256: sha(consent.buildCheckoutConsentText(draft)), plan: { price: 1000, credits: 10 } }
  const parsed = consent.parseCheckoutConsentBundle(bundle)
  assert.ok(parsed)
  assert.equal(parsed.plan, undefined)
  assert.equal(sha(consent.buildCheckoutConsentText(parsed)), bundle.noticeSha256)
  assert.equal(parsePointChargeCheckoutNotice(bundle), null)
  assert.equal(parseMarketPurchaseNotice(bundle), null)
  assert.equal(consent.parseCheckoutConsentBundle({ checkboxLabel: 'a', confirmNotice: 'b', noticeSha256: 'a'.repeat(64), refundDays: 7, consentFormat: 1 }), null)
  assert.equal(consent.parseCheckoutConsentBundle({ ...bundle, consentFormat: '2' }), null)
  // 구조 비교(6-4): 지문이 같아도 항목 수·texts 수가 다르면 다르다
  const fewer = { ...parsed, consentItems: parsed.consentItems.slice(1) }
  assert.notEqual(consent.checkoutConsentStructureKey(parsed), consent.checkoutConsentStructureKey(fewer))
  assert.equal(consent.checkoutConsentStructureKey(parsed), consent.checkoutConsentStructureKey({ ...parsed, consentTitle: '다른 제목' }))
})

test('{충전유효기간} = 서버 상수 = SQL 상수 1 = 지급 함수 1 year(4-2)', () => {
  assert.equal(POINT_CHARGE_VALIDITY_YEARS, 1)
  assert.equal(consent.fillCheckoutConsentText('point_charge', '{충전유효기간}년·{충전환불기간}일', 7), '1년·7일')
  assert.equal(consent.fillCheckoutConsentText('market', '{충전유효기간}·{자료환불기간}', 30), '{충전유효기간}·30')
  assert.match(read('supabase/migrations/20261216100000_checkout_consent_v2.sql'), /c_years constant text := '1';/)
  assert.match(read('supabase/migrations/20261126100000_member_withdrawal.sql'), /p_approved_at \+ interval '1 year'/)
})

test('SQL 과 같은 식: 기간 숫자 금지·비지 않음·키 규칙 정규식이 마이그레이션에 그대로 있다', () => {
  const migration = read('supabase/migrations/20261216100000_checkout_consent_v2.sql')
  const lib = read('src/lib/checkout-consent.ts')
  const korean = '([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \\t\\n]*(일째|일|년|개월|달|주일|주|시간)'
  assert.ok(lib.includes(`/${korean}/`))
  assert.ok(migration.includes(`'${korean}'`))
  assert.ok(lib.includes('/(하루|이틀|사흘|나흘|열흘|보름|한 해)/') && migration.includes("'(하루|이틀|사흘|나흘|열흘|보름|한 해)'"))
  assert.ok(lib.includes('/[0-9０-９]/') && migration.includes("'[0-9０-９]'"))
  assert.ok(lib.includes('/[^ \\t\\n\\r]/') && migration.includes("'[^ \\t\\n\\r]'"))
  assert.ok(lib.includes('/^[a-z][A-Za-z0-9]{0,29}$/') && migration.includes("'^[a-z][A-Za-z0-9]{0,29}$'"))
  for (const limit of ['26', '120', '220', '30']) assert.ok(migration.includes(limit))
})

test('세부 항목 창: 높이는 내용에 맞추고(최대는 화면 안, studio-theme 의 min-height 를 끔) 목록만 스크롤, [닫기]는 목록 바로 아래', () => {
  const source = read('src/components/checkout/checkout-consent.tsx')
  assert.match(source, /className=\{cn\('flex h-auto max-h-\[min\(640px,calc\(100dvh-2rem\)\)\] flex-col gap-4 sm:max-w-\[480px\]', dialogClassName, 'min-h-0'\)\}/)
  const list = source.slice(source.indexOf('<ul className="-mx-2'), source.indexOf('</ul>', source.indexOf('<ul className="-mx-2')))
  assert.match(list, /^<ul className="-mx-2 min-h-0 shrink overflow-y-auto px-2 text-sm">/)
  assert.doesNotMatch(list.split('\n')[0], /flex-1|h-full|min-h-screen/)
  // 목록 다음이 바로 버튼 줄([닫기] 하나)
  const after = source.slice(source.indexOf('</ul>', source.indexOf('<ul className="-mx-2')))
  assert.match(after, /^<\/ul>\n\s+<StudioDialogFooter>\n\s+<Button type="button" variant="brand" onClick=\{\(\) => setDialogOpen\(false\)\}>\n\s+닫기/)
})
