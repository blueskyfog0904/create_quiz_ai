import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'

// 20번 5-1: 상태 → 색 대응은 src/lib/admin-status-tone.ts 한 파일에만 있고, 이름표의 모든 값을 덮는다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const orders = load('src/lib/admin-orders.ts')
const suspension = load('src/lib/admin-member-suspension.ts')
const { ADMIN_STATUS_TONES, ADMIN_TONES, adminStatusTone } = load('src/lib/admin-status-tone.ts')

const LABEL_TABLES = {
  paymentOrder: orders.PAYMENT_ORDER_STATUS_LABELS,
  refundRequest: orders.REFUND_REQUEST_STATUS_LABELS,
  creditSource: orders.CREDIT_SOURCE_STATUS_LABELS,
  marketOrder: orders.MARKET_ORDER_STATUS_LABELS,
  marketRefundRequest: orders.MARKET_REFUND_REQUEST_STATUS_LABELS,
  marketEntitlement: orders.MARKET_ENTITLEMENT_STATUS_LABELS,
  marketItem: orders.MARKET_ITEM_STATUS_LABELS,
}

const sortedKeys = (object) => Object.keys(object).sort()

test('admin-orders.ts 의 상태 이름표 값을 빠짐없이(남는 것 없이) 덮는다', () => {
  for (const [kind, labels] of Object.entries(LABEL_TABLES)) {
    assert.deepEqual(sortedKeys(ADMIN_STATUS_TONES[kind]), sortedKeys(labels), `${kind} 색 표가 이름표와 다름`)
  }
  // admin-orders.ts 에 *_STATUS_LABELS 이름표가 새로 생기면 여기(와 색 표)에 더해야 한다.
  const statusTables = Object.keys(orders).filter((name) => /_STATUS_LABELS$/.test(name)).sort()
  assert.deepEqual(statusTables, [
    'CREDIT_SOURCE_STATUS_LABELS',
    'MARKET_ENTITLEMENT_STATUS_LABELS',
    'MARKET_ITEM_STATUS_LABELS',
    'MARKET_ORDER_STATUS_LABELS',
    'MARKET_REFUND_REQUEST_STATUS_LABELS',
    'PAYMENT_ORDER_STATUS_LABELS',
    'REFUND_REQUEST_STATUS_LABELS',
  ])
})

test('문의 상태는 support-client.tsx statusConfig 키를, 회원은 12번 정지 범위 키를 덮는다', () => {
  const support = read('src/app/(admin)/admin/support/support-client.tsx')
  const config = support.match(/const statusConfig[^=]*= \{([\s\S]*?)\n\}/)
  assert.ok(config, 'statusConfig 를 찾지 못함')
  const supportKeys = [...config[1].matchAll(/^\s+(\w+): \{ label:/gm)].map((match) => match[1]).sort()
  assert.deepEqual(sortedKeys(ADMIN_STATUS_TONES.supportTicket), supportKeys)

  for (const scope of Object.keys(suspension.SUSPENSION_SCOPE_LABELS)) {
    assert.equal(ADMIN_STATUS_TONES.member[scope], 'danger', `정지 범위 ${scope} 는 빨강`)
  }
  assert.deepEqual(sortedKeys(ADMIN_STATUS_TONES.member), ['active', 'login_blocked', 'restricted', 'suspension_lifted', 'withdrawn'])
  assert.deepEqual(sortedKeys(ADMIN_STATUS_TONES.banner), ['ended', 'live', 'off', 'scheduled'])
})

test("5-1 표(대표 확인 대상) 그대로이고 '환불 완료'는 어느 표에서나 info", () => {
  const expected = {
    paymentOrder: { neutral: ['expired'], info: ['preparing', 'ready_unknown', 'ready', 'confirming', 'fulfillment_pending', 'cancel_pending', 'refunded'], success: ['completed'], warning: ['manual_review'], danger: ['failed'] },
    refundRequest: { info: ['processing', 'completed'], warning: ['pending_review', 'retryable_failed', 'manual_review'], danger: ['rejected'] },
    creditSource: { neutral: ['refunded'], info: ['pending_refund'], success: ['active'] },
    marketOrder: { info: ['refunded'], success: ['completed'], danger: ['revoked', 'failed'] },
    marketRefundRequest: { neutral: ['canceled'], success: ['approved'], warning: ['pending'], danger: ['rejected', 'failed'] },
    marketEntitlement: { info: ['refunded'], success: ['active'], danger: ['revoked'] },
    marketItem: { neutral: ['draft', 'archived'], success: ['published'], warning: ['hidden'] },
    supportTicket: { neutral: ['closed'], info: ['in_progress'], success: ['resolved'], warning: ['pending'], danger: ['deleted'] },
    member: { neutral: ['withdrawn', 'suspension_lifted'], success: ['active'], danger: ['restricted', 'login_blocked'] },
    banner: { neutral: ['off', 'ended'], info: ['scheduled'], success: ['live'] },
    reviewTag: { neutral: ['inactive'], success: ['active'] },
    pricingPlan: { neutral: ['inactive'], success: ['active'] },
    // 20번 5단계: 크레딧 거래 종류(평범한 사용 = 회색, 회수만 빨강 — Q6), 문의 카테고리·답변 템플릿 사용·숨김
    creditTransaction: { neutral: ['gray'], info: ['blue'], success: ['green'], warning: ['amber'], danger: ['red'] },
    supportOption: { neutral: ['hidden'], success: ['active'] },
    // 20번 6단계: 상품 설정 항목(카테고리 칸·서브상품 카테고리·파일 유형·서브상품 활성/비활성, 학년·자료유형 사용/숨김)
    productSetting: { neutral: ['inactive'], success: ['active'] },
  }
  assert.deepEqual(sortedKeys(ADMIN_STATUS_TONES), sortedKeys(expected))
  for (const [kind, groups] of Object.entries(expected)) {
    const flattened = Object.fromEntries(Object.entries(groups).flatMap(([tone, values]) => values.map((value) => [value, tone])))
    assert.deepEqual({ ...ADMIN_STATUS_TONES[kind] }, flattened, `${kind} 색 대응이 5-1 표와 다름`)
  }
  for (const [kind, labels] of Object.entries(LABEL_TABLES)) {
    for (const [value, label] of Object.entries(labels)) {
      if (label === '환불 완료') assert.equal(ADMIN_STATUS_TONES[kind][value], 'info', `${kind}.${value}`)
    }
  }
})

test('모든 tone 은 다섯 가지 중 하나이고, 표에 없는 값은 회색', () => {
  for (const tones of Object.values(ADMIN_STATUS_TONES)) {
    for (const tone of Object.values(tones)) assert.ok(ADMIN_TONES.includes(tone), tone)
  }
  assert.equal(adminStatusTone('paymentOrder', 'failed'), 'danger')
  assert.equal(adminStatusTone('paymentOrder', 'something_new'), 'neutral')
  assert.equal(adminStatusTone('marketItem', null), 'neutral')
  assert.equal(adminStatusTone('paymentOrder', 'toString'), 'neutral')
})
