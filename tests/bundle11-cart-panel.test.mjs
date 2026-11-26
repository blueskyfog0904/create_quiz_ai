import assert from 'node:assert/strict'
import test from 'node:test'
import '../src/components/features/passages/node-test-register.mjs'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// 11번 계획 11-1 '장바구니 껍데기·순수 함수'·'배치': 결제 칸 순수 함수(src/lib/cart-checkout-panel.ts, checkout-panel-layout.ts).
const panel = await import('../src/lib/cart-checkout-panel.ts')
const layout = await import('../src/lib/checkout-panel-layout.ts')

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)

function consentBundle({ sha = SHA_A, summary = ['요약 하나', '요약 둘'], items = null } = {}) {
  return {
    consentFormat: 2,
    consentTitle: '주문 내용 확인 및 동의',
    consentSummary: summary,
    consentItems: items ?? [
      { key: 'purchaseNotice', label: '자료 환불 안내', view: 'text', texts: ['본문'] },
      { key: 'refundPolicy', label: '취소·환불정책', view: 'link', link: 'refundPolicy' },
      { key: 'terms', label: '서비스 이용약관', view: 'link', link: 'serviceTerms' },
    ],
    noticeSha256: sha,
    refundDays: 7,
  }
}
const legacyNotice = (sha = SHA_A) => ({ checkboxLabel: '확인했습니다', confirmNotice: '본문', noticeSha256: sha, refundDays: 7 })
const cartTexts = (sha = SHA_C) => ({ cartCheckoutNotice: '한 번에 구매합니다.', partialOwnedConfirmLabel: '정가 구매를 확인했습니다.', cartTextsSha256: sha })

function line(id, overrides = {}) {
  return {
    id, targetKind: 'subproduct', targetId: id, itemId: `item-${id}`, workspaceSubject: 'korean', itemTitle: `자료 ${id}`,
    optionTitle: null, categoryName: null, purchasable: true, reason: null, partiallyOwned: false, originalCredits: 100,
    chargedCredits: 100, isSelected: true, createdAt: '2026-11-26T00:00:00Z', detailHref: null, categorySlug: 'question_pdf',
    includesPdf: false, ...overrides,
  }
}

function input(overrides = {}) {
  return { noticeCopy: { format: 2, consent: consentBundle() }, cartTexts: cartTexts(), orderKey: 'k1', partialKey: '', ...overrides }
}

// ── 뷰 칸 → 사본 ────────────────────────────────────────────────────────────────────────────────
test('사본: 2판 칸이 있으면 2판, 1판 칸만 있으면 1판, 둘 다 없으면 고지 없음', () => {
  assert.equal(panel.noticeCopyFromView({ purchaseConsent: consentBundle(), purchaseNotice: null }).format, 2)
  assert.equal(panel.noticeCopyFromView({ purchaseConsent: null, purchaseNotice: legacyNotice() }).format, 1)
  assert.equal(panel.noticeCopyFromView({ purchaseConsent: null, purchaseNotice: null }), null)
})

test('409 details: 2판 묶음·1판 고지 모두 새 해석기로 읽고, 둘 다 아니면 null', () => {
  assert.equal(panel.noticeCopyFromDetails(consentBundle()).format, 2)
  assert.equal(panel.noticeCopyFromDetails({ ...legacyNotice(), consentFormat: 1 }).format, 1)
  assert.equal(panel.noticeCopyFromDetails({ consentFormat: 2, consentTitle: 'x' }), null)
  assert.equal(panel.noticeCopyFromDetails(null), null)
})

// ── 동의 수명(6-4) ──────────────────────────────────────────────────────────────────────────────
test('동의 수명: 지문이 바뀌면 사본 교체·동의 비움·안내 문구 바뀜', () => {
  const prev = { ...panel.initialConsentState(input()), checkedKeys: ['purchaseNotice', 'refundPolicy', 'terms'], partialAck: true }
  const r = panel.reconcileConsent(prev, input({ noticeCopy: { format: 2, consent: consentBundle({ sha: SHA_B }) } }))
  assert.deepEqual(r.state.checkedKeys, [])
  assert.equal(r.state.noticeCopy.consent.noticeSha256, SHA_B)
  assert.equal(r.noticeChanged, true)
  assert.equal(r.state.partialAck, true, '고지만 바뀌면 부분 보유 확인은 그대로')
})

test('동의 수명: 지문이 같아도 구조(요약 줄 수·항목 수·key·view·texts 수)가 다르면 비운다', () => {
  const prev = { ...panel.initialConsentState(input()), checkedKeys: ['purchaseNotice'] }
  for (const consent of [
    consentBundle({ summary: ['하나'] }),
    consentBundle({ items: [{ key: 'purchaseNotice', label: 'a', view: 'text', texts: ['본문', '둘'] },
      { key: 'refundPolicy', label: 'b', view: 'link', link: 'refundPolicy' }, { key: 'terms', label: 'c', view: 'link', link: 'serviceTerms' }] }),
    consentBundle({ items: [{ key: 'other', label: 'a', view: 'text', texts: ['본문'] },
      { key: 'refundPolicy', label: 'b', view: 'link', link: 'refundPolicy' }, { key: 'terms', label: 'c', view: 'link', link: 'serviceTerms' }] }),
  ]) {
    const r = panel.reconcileConsent(prev, input({ noticeCopy: { format: 2, consent } }))
    assert.deepEqual(r.state.checkedKeys, [])
    assert.equal(r.noticeChanged, true)
  }
  // 글만 다르고 지문·구조가 같으면 그대로(DB 가 같은 지문을 냄)
  const same = panel.reconcileConsent(prev, input())
  assert.deepEqual(same.state.checkedKeys, ['purchaseNotice'])
  assert.equal(same.noticeChanged, false)
})

test('동의 수명: 1판 ↔ 2판 판이 바뀌어도 비운다', () => {
  const prev = { ...panel.initialConsentState(input()), checkedKeys: ['purchaseNotice'] }
  const r = panel.reconcileConsent(prev, input({ noticeCopy: { format: 1, notice: legacyNotice() } }))
  assert.deepEqual(r.state.checkedKeys, [])
})

test('동의 수명: 주문 키가 바뀌면 동의를 비우고, 켜져 있던 때만 주문 내용 바뀜 안내', () => {
  const checked = { ...panel.initialConsentState(input()), checkedKeys: ['terms'] }
  const r1 = panel.reconcileConsent(checked, input({ orderKey: 'k2' }))
  assert.deepEqual(r1.state.checkedKeys, [])
  assert.equal(r1.orderChangedWhileChecked, true)
  const unchecked = panel.initialConsentState(input())
  const r2 = panel.reconcileConsent(unchecked, input({ orderKey: 'k2' }))
  assert.equal(r2.orderChangedWhileChecked, false)
})

test('동의 수명: 장바구니 문구 지문이 바뀌면 동의와 부분 보유 확인을 모두 비운다', () => {
  const prev = { ...panel.initialConsentState(input()), checkedKeys: ['terms'], partialAck: true }
  const r = panel.reconcileConsent(prev, input({ cartTexts: cartTexts(SHA_B) }))
  assert.deepEqual(r.state.checkedKeys, [])
  assert.equal(r.state.partialAck, false)
  assert.equal(r.state.cartTexts.cartTextsSha256, SHA_B)
})

test('동의 수명: 선택된 부분 보유 줄 묶음이 바뀌면 부분 보유 확인을 비운다(동의는 그대로)', () => {
  const prev = { ...panel.initialConsentState(input({ partialKey: 'a' })), checkedKeys: ['terms'], partialAck: true }
  const r = panel.reconcileConsent(prev, input({ partialKey: 'a|b' }))
  assert.equal(r.state.partialAck, false)
  assert.deepEqual(r.state.checkedKeys, ['terms'])
})

test('동의 수명: 성공하면 동의·부분 보유 확인을 모두 비운다', () => {
  const s = panel.clearConsentAfterSuccess({ ...panel.initialConsentState(input()), checkedKeys: ['terms'], partialAck: true })
  assert.deepEqual(s.checkedKeys, [])
  assert.equal(s.partialAck, false)
})

test('동의 수명: 체크가 켜진 채 지문·구조만 바뀌는 길이 없다(여러 바뀜을 섞어도)', () => {
  const variants = [
    input({ noticeCopy: { format: 2, consent: consentBundle({ sha: SHA_B }) } }),
    input({ noticeCopy: { format: 2, consent: consentBundle({ summary: ['하나'] }) } }),
    input({ noticeCopy: { format: 1, notice: legacyNotice(SHA_B) } }),
    input({ noticeCopy: null }),
    input({ cartTexts: cartTexts(SHA_B) }),
    input({ cartTexts: null }),
  ]
  for (const next of variants) {
    const prev = { ...panel.initialConsentState(input()), checkedKeys: ['purchaseNotice', 'refundPolicy', 'terms'] }
    const r = panel.reconcileConsent(prev, next)
    assert.deepEqual(r.state.checkedKeys, [], JSON.stringify(next).slice(0, 80))
  }
})

test('동의 완료: 2판은 항목 key 전부, 1판은 체크 하나, 고지 없으면 완료 아님', () => {
  const copy2 = { format: 2, consent: consentBundle() }
  assert.equal(panel.isConsentComplete(copy2, ['purchaseNotice', 'refundPolicy']), false)
  assert.equal(panel.isConsentComplete(copy2, ['purchaseNotice', 'refundPolicy', 'terms']), true)
  assert.equal(panel.isConsentComplete({ format: 1, notice: legacyNotice() }, [panel.LEGACY_CONSENT_KEY]), true)
  assert.equal(panel.isConsentComplete(null, []), false)
})

test('주문 키: 선택 줄 cartItemId 정렬 + 줄별 금액, 순서가 달라도 같고 금액이 바뀌면 다르다', () => {
  const a = panel.buildOrderKey([{ id: 'b', chargedCredits: 2 }, { id: 'a', chargedCredits: 1 }])
  assert.equal(a, panel.buildOrderKey([{ id: 'a', chargedCredits: 1 }, { id: 'b', chargedCredits: 2 }]))
  assert.notEqual(a, panel.buildOrderKey([{ id: 'a', chargedCredits: 1 }, { id: 'b', chargedCredits: 3 }]))
  assert.equal(panel.buildPartialKey([{ id: 'b', partiallyOwned: true }, { id: 'a', partiallyOwned: false }]), 'b')
})

// ── 버튼 이름 순서(6-3) ─────────────────────────────────────────────────────────────────────────
const ready = {
  submitting: false, reloading: false, saving: false, reloadFailed: false, retryable: false, selectedCount: 2,
  noticeAvailable: true, hasConflict: false, total: 300, balance: 1000, needsPartialAck: false, partialAck: false, consentComplete: true,
  // 잔액 부족 때 버튼 이름은 DB 값(cartChargeButtonLabel·cartBalanceRecheckLabel)
  insufficientLabels: { charge: 'DB 충전 버튼', recheck: 'DB 다시 확인' },
}

test('버튼: 겹치면 결제 중 → 다시 읽는 중 → 선택 저장 중 → 다시 읽기 실패 → retryable → 0건 → 충돌 → 부족 → 고지 없음 → 부분 보유 → 동의 → 결제(부족을 고지 없음보다 앞 — 대표 요청)', () => {
  const order = [
    ['submitting', { submitting: true }],
    ['reloading', { reloading: true }],
    ['saving', { saving: true }],
    ['reloadFailed', { reloadFailed: true }],
    ['retryable', { retryable: true }],
    ['empty', { selectedCount: 0 }],
    ['conflict', { hasConflict: true }],
    ['insufficient', { balance: 10 }],
    ['noNotice', { noticeAvailable: false }],
    ['partialAck', { needsPartialAck: true }],
    ['consent', { consentComplete: false }],
  ]
  // 앞 상태들을 모두 켠 채 하나씩 끄면 다음 상태가 나온다.
  let all = { ...ready }
  for (const [, patch] of order) all = { ...all, ...patch }
  for (const [state, patch] of order) {
    assert.equal(panel.decideCheckoutButton(all).state, state)
    for (const key of Object.keys(patch)) all[key] = ready[key]
  }
  const done = panel.decideCheckoutButton(ready)
  assert.equal(done.state, 'ready')
  assert.equal(done.primaryLabel, '300 크레딧 결제하기')
  assert.equal(done.primaryEnabled, true)
})

test('버튼: 충돌 + 부족이면 충돌 이름이고 금액 줄에 부족이 없다(부풀어 오른 합계로 충전을 권하지 않음)', () => {
  const d = panel.decideCheckoutButton({ ...ready, hasConflict: true, balance: 10 })
  assert.equal(d.state, 'conflict')
  assert.doesNotMatch(d.primaryLabel, /충전|부족/)
  assert.equal(d.secondaryLabel, null)
  assert.doesNotMatch(panel.buildAmountLine({ total: 300, balance: 10, hasConflict: true }), /부족|잔액/)
  assert.equal(panel.buildAmountLine({ total: 300, balance: 10, hasConflict: false }), '합계 300 · 부족 290')
  assert.equal(panel.buildAmountLine({ total: 1234567, balance: 2000000, hasConflict: false }), '합계 1,234,567 · 결제 후 잔액 765,433')
})

test('버튼: 금액 줄에 단위(크레딧)를 붙이지 않는다', () => {
  for (const balance of [0, 300, 99999999]) {
    assert.doesNotMatch(panel.buildAmountLine({ total: 300, balance, hasConflict: false }), /크레딧/)
  }
})

test('버튼: 0건이면 동의 체크도 비활성, 결제 중·retryable 은 목록·동의를 잠그고 retryable·부족만 두 버튼', () => {
  assert.equal(panel.decideCheckoutButton({ ...ready, selectedCount: 0 }).consentDisabled, true)
  assert.equal(panel.decideCheckoutButton({ ...ready, submitting: true }).locked, true)
  const retry = panel.decideCheckoutButton({ ...ready, retryable: true })
  assert.equal(retry.locked, true)
  assert.deepEqual([retry.primaryLabel, retry.secondaryLabel], ['같은 요청으로 다시 시도', '다시 선택'])
  const short = panel.decideCheckoutButton({ ...ready, balance: 0 })
  assert.deepEqual([short.primaryLabel, short.secondaryLabel], ['DB 충전 버튼', 'DB 다시 확인'])
  for (const state of [ready, { ...ready, consentComplete: false }, { ...ready, hasConflict: true }]) {
    assert.equal(panel.decideCheckoutButton(state).secondaryLabel, null)
  }
})

test('막대 초점 대상: 비활성 상태는 알림 자리·제목, 막힌 조작이 있으면 그 조작', () => {
  const target = (patch) => panel.decideCheckoutButton({ ...ready, ...patch }).focusTarget
  assert.equal(target({ submitting: true }), 'status')
  assert.equal(target({ reloading: true }), 'status')
  assert.equal(target({ saving: true }), 'status')
  assert.equal(target({ selectedCount: 0 }), 'title')
  assert.equal(target({ reloadFailed: true }), 'reload')
  assert.equal(target({ noticeAvailable: false }), 'reload')
  assert.equal(target({ hasConflict: true }), 'conflict')
  assert.equal(target({ needsPartialAck: true }), 'partialAck')
  assert.equal(target({ consentComplete: false }), 'consent')
  assert.equal(target({}), 'primary')
  assert.equal(target({ retryable: true }), 'primary')
})

// ── 충돌 판정 ──────────────────────────────────────────────────────────────────────────────────
test('충돌: 장바구니 줄의 categorySlug·includesPdf 로 DB 6단계와 같게 판정한다', () => {
  const pdf = line('p', { itemId: 'i1', categorySlug: 'question_pdf' })
  const hwpWithPdf = line('h', { itemId: 'i1', categorySlug: 'question_hwp', includesPdf: true })
  const hwpNoPdf = line('h2', { itemId: 'i1', categorySlug: 'question_hwp', includesPdf: false })
  const bundle = line('b', { itemId: 'i1', targetKind: 'bundle', categorySlug: null })
  const other = line('o', { itemId: 'i2', targetKind: 'bundle', categorySlug: null })
  assert.deepEqual([...panel.conflictingLineIds([pdf, hwpWithPdf])].sort(), ['h', 'p'])
  assert.equal(panel.conflictingLineIds([pdf, hwpNoPdf]).size, 0)
  assert.deepEqual([...panel.conflictingLineIds([bundle, pdf])].sort(), ['b', 'p'])
  assert.equal(panel.conflictingLineIds([pdf, other]).size, 0)
})

// ── 요청·응답(6-4) ────────────────────────────────────────────────────────────────────────────
test('요청: 화면은 cartTextsSha256 을 계산하지 않고 사본 값을 그대로 보낸다', () => {
  const body = panel.buildCheckoutRequest({
    lines: [line('a', { partiallyOwned: true }), line('b')],
    partialAck: true,
    noticeCopy: { format: 2, consent: consentBundle({ sha: SHA_B }) },
    cartTexts: cartTexts('d'.repeat(64)),
    idempotencyKey: 'key-1',
  })
  assert.equal(body.cartTextsSha256, 'd'.repeat(64))
  assert.equal(body.noticeSha256, SHA_B)
  assert.deepEqual(body.items, [
    { cartItemId: 'a', expectedCredits: 100, acknowledgeNoDiscount: true },
    { cartItemId: 'b', expectedCredits: 100, acknowledgeNoDiscount: false },
  ])
  assert.equal(body.acknowledgePurchaseNotice, true)
})

const snap = { snapshot: { items: [{ cartItemId: 'a', expectedCredits: 100, acknowledgeNoDiscount: false }], idempotencyKey: 'k', acknowledgePurchaseNotice: true, noticeSha256: SHA_A, cartTextsSha256: SHA_C } }
const err = (status, code, extra = {}) => ({ status, payload: { success: false, error: { code, message: `${code} 안내` }, ...extra } })

test('응답: 네트워크 오류·5xx 만 retryable(스냅숏 유지), 그 밖은 버림', () => {
  assert.equal(panel.reduceCheckoutResponse(snap, { status: null, payload: null }).kind, 'retryable')
  assert.equal(panel.reduceCheckoutResponse(snap, err(503, 'PURCHASE_NOTICE_UNAVAILABLE')).kind, 'retryable')
  assert.equal(panel.reduceCheckoutResponse(snap, err(503, 'RECEIPT_LOOKUP_FAILED')).kind, 'retryable')
  assert.equal(panel.reduceCheckoutResponse(snap, err(500, 'INTERNAL_SERVER_ERROR')).kind, 'retryable')
  for (const [status, code] of [[409, 'CART_CHANGED'], [409, 'ALREADY_OWNED'], [409, 'BUNDLE_COMPONENTS_EMPTY'], [409, 'IDEMPOTENCY_CONFLICT'],
    [400, 'INVALID_INPUT'], [400, 'CART_TEXTS_REQUIRED'], [404, 'NOT_FOUND'], [422, 'CART_LIMIT']]) {
    assert.equal(panel.reduceCheckoutResponse(snap, err(status, code)).kind, 'reload', code)
  }
  assert.equal(panel.reduceCheckoutResponse(snap, err(401, 'UNAUTHORIZED')).kind, 'login')
  assert.equal(panel.reduceCheckoutResponse(snap, err(402, 'INSUFFICIENT_CREDITS')).kind, 'insufficient')
})

test('응답: CART_CHANGED·ALREADY_OWNED 만 직전 키 재조회 대상', () => {
  assert.equal(panel.reduceCheckoutResponse(snap, err(409, 'CART_CHANGED')).recheckReceipt, true)
  assert.equal(panel.reduceCheckoutResponse(snap, err(409, 'ALREADY_OWNED')).recheckReceipt, true)
  assert.equal(panel.reduceCheckoutResponse(snap, err(409, 'IDEMPOTENCY_CONFLICT')).recheckReceipt, false)
})

test('응답: 성공은 영수증·잔액, PRICE_CHANGED 는 이전 가격을 따로', () => {
  const ok = panel.reduceCheckoutResponse(snap, { status: 200, payload: { success: true, data: { orders: [], totalCredits: 100, balanceAfter: 5 }, alreadyCompleted: true, balance: 7 } })
  assert.equal(ok.kind, 'success')
  assert.equal(ok.alreadyCompleted, true)
  assert.equal(ok.balance, 7)
  const price = panel.reduceCheckoutResponse(snap, err(409, 'PRICE_CHANGED', { details: { items: [{ cartItemId: 'a', purchasable: true, chargedCredits: 150 }] } }))
  assert.equal(price.kind, 'priceChanged')
  assert.deepEqual(price.previousCredits, { a: 100 })
})

test('응답: PURCHASE_NOTICE_CHANGED 는 details·cartTexts 를 새 해석기로 읽고, 실패면 잠그고 다시 읽기', () => {
  const ok = panel.reduceCheckoutResponse(snap, err(409, 'PURCHASE_NOTICE_CHANGED', { details: consentBundle({ sha: SHA_B }), cartTexts: cartTexts() }))
  assert.equal(ok.kind, 'noticeChanged')
  assert.equal(ok.parseFailed, false)
  assert.equal(ok.noticeCopy.consent.noticeSha256, SHA_B)
  const v1 = panel.reduceCheckoutResponse(snap, err(409, 'PURCHASE_NOTICE_CHANGED', { details: { ...legacyNotice(SHA_B), consentFormat: 1 }, cartTexts: cartTexts() }))
  assert.equal(v1.noticeCopy.format, 1)
  const broken = panel.reduceCheckoutResponse(snap, err(409, 'PURCHASE_NOTICE_CHANGED', { details: { consentFormat: 2 }, cartTexts: cartTexts() }))
  assert.equal(broken.parseFailed, true)
  const noCart = panel.reduceCheckoutResponse(snap, err(409, 'PURCHASE_NOTICE_CHANGED', { details: consentBundle(), cartTexts: null }))
  assert.equal(noCart.parseFailed, true)
})

test('응답: 낡은 뷰에서 ACK_REQUIRED → details.lines 줄을 부분 보유로 돌려준다', () => {
  const r = panel.reduceCheckoutResponse(snap, err(409, 'ACK_REQUIRED', { details: { lines: [{ cartItemId: 'a', targetKind: 'bundle', targetId: 't' }] } }))
  assert.equal(r.kind, 'ackRequired')
  assert.deepEqual(r.lineIds, ['a'])
})

test('응답: CONFLICTING_SELECTION 의 details.itemIds 는 자료 id 로 돌려준다', () => {
  const r = panel.reduceCheckoutResponse(snap, err(422, 'CONFLICTING_SELECTION', { details: { itemIds: ['item-1', 3] } }))
  assert.equal(r.kind, 'conflicting')
  assert.deepEqual(r.itemIds, ['item-1'])
})

test('[다시 선택]: 200 완료, 404 스냅숏 버림, 그 밖 retryable 유지 / 직전 키 줄이 사라지면 재조회', () => {
  assert.equal(panel.classifyReceiptLookup(200, { success: true, data: {} }), 'completed')
  assert.equal(panel.classifyReceiptLookup(404, {}), 'notFound')
  assert.equal(panel.classifyReceiptLookup(500, {}), 'keepRetryable')
  assert.equal(panel.classifyReceiptLookup(null, null), 'keepRetryable')
  assert.equal(panel.shouldRecheckAfterReload({ lineIds: ['a', 'b'] }, [{ id: 'a' }]), true)
  assert.equal(panel.shouldRecheckAfterReload({ lineIds: ['a'] }, [{ id: 'a' }]), false)
  assert.equal(panel.shouldRecheckAfterReload(null, []), false)
})

test('완료 창은 겹치면 차례로 보인다', () => {
  let queue = panel.enqueueComplete([], 'first')
  queue = panel.enqueueComplete(queue, 'second')
  assert.equal(queue[0], 'first')
  queue = panel.dequeueComplete(queue)
  assert.deepEqual(queue, ['second'])
})

// ── 배치(6-2 원칙 3) ────────────────────────────────────────────────────────────────────────────
test('배치: 아래 묶음 + 위 영역 최소가 들어가면 sticky, 넘치면 보통 흐름(경계값 포함)', () => {
  const max = layout.checkoutPanelMaxInnerHeight(640)
  const min = layout.CHECKOUT_PANEL_TOP_MIN_HEIGHT
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: max - min, maxInnerHeight: max }), 'sticky')
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: max - min + 1, maxInnerHeight: max }), 'flow')
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: 0, maxInnerHeight: max }), 'flow')
  assert.equal(layout.decideCheckoutPanelMode({ bottomHeight: 200, maxInnerHeight: Number.NaN }), 'flow')
})

test('reconcileAnnouncement: 응답 이유가 있으면 주문 바뀜은 알리지 않고 고지 바뀜은 이유 뒤에 붙인다', () => {
  const none = { noticeChanged: false, orderChangedWhileChecked: false }
  const order = { noticeChanged: false, orderChangedWhileChecked: true }
  const notice = { noticeChanged: true, orderChangedWhileChecked: true }
  assert.equal(panel.reconcileAnnouncement(none, null), null)
  assert.deepEqual(panel.reconcileAnnouncement(order, null), { text: panel.ORDER_CHANGED_MESSAGE, kind: 'status' })
  assert.deepEqual(panel.reconcileAnnouncement(notice, null), { text: panel.NOTICE_CHANGED_MESSAGE, kind: 'status' })
  assert.equal(panel.reconcileAnnouncement(order, '가격이 바뀌었습니다.'), null)
  assert.deepEqual(panel.reconcileAnnouncement(notice, '가격이 바뀌었습니다.'),
    { text: `가격이 바뀌었습니다. ${panel.NOTICE_CHANGED_MESSAGE}`, kind: 'alert' })
})

test('viewWithNoticeCopy: 409 사본을 판에 맞는 칸에만 넣어, 그 뷰로 다시 맞춰도 사본이 되돌아가지 않는다', () => {
  const oldNotice = { checkboxLabel: '옛', confirmNotice: '옛 본문', noticeSha256: 'a'.repeat(64), refundDays: 30 }
  const bundle = { consentFormat: 2, consentTitle: '새 제목', consentSummary: ['줄'], noticeSha256: 'b'.repeat(64), refundDays: 30,
    consentItems: [{ key: 'refundPolicy', label: '정책', view: 'link', link: 'refundPolicy' }, { key: 'terms', label: '약관', view: 'link', link: 'serviceTerms' }] }
  const cartTexts = { cartCheckoutNotice: '안내', partialOwnedConfirmLabel: '확인', cartTextsSha256: 'c'.repeat(64) }
  const view = { items: [], purchaseNotice: oldNotice, purchaseConsent: null, cartTexts: null, balance: 0 }
  const copy = { format: 2, consent: bundle }
  const next = panel.viewWithNoticeCopy(view, copy, cartTexts)
  assert.equal(next.purchaseNotice, null)
  assert.equal(next.purchaseConsent, bundle)
  assert.equal(next.cartTexts, cartTexts)
  assert.equal(panel.noticeCopyIdentity(panel.noticeCopyFromView(next)), panel.noticeCopyIdentity(copy))
  const back = panel.viewWithNoticeCopy(next, { format: 1, notice: oldNotice }, null)
  assert.equal(back.purchaseConsent, null)
  assert.equal(back.purchaseNotice, oldNotice)
})

test('부족 + 고지 없음: 충전으로 안내(주 버튼 [크레딧 충전하기], 보조 [잔액 다시 확인]), 결제 버튼은 없음', () => {
  const d = panel.decideCheckoutButton({ ...ready, noticeAvailable: false, balance: 10 })
  assert.equal(d.state, 'insufficient')
  assert.equal(d.primaryLabel, 'DB 충전 버튼')
  assert.equal(d.secondaryLabel, 'DB 다시 확인')
  assert.equal(d.focusTarget, 'primary')
  assert.equal(panel.decideCheckoutButton({ ...ready, noticeAvailable: false }).state, 'noNotice')
})

test('부족 + 버튼 이름 없음(DB 키 없음·깨짐): 이름 없는 충전 버튼을 만들지 않고 결제만 막는다', () => {
  const d = panel.decideCheckoutButton({ ...ready, balance: 10, insufficientLabels: null })
  assert.equal(d.state, 'insufficient')
  assert.equal(d.primaryEnabled, false)
  assert.equal(d.secondaryLabel, null)
  assert.equal(d.focusTarget, 'title')
  // 버튼 이름은 코드에 두지 않는다
  assert.doesNotMatch(read('src/lib/cart-checkout-panel.ts'), /크레딧 충전하기|'잔액 다시 확인'/)
})
