import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const operations = readFileSync(
  new URL('../docs/tosspayments-point-charge-operations.md', import.meta.url),
  'utf8'
)
const evidence = readFileSync(
  new URL('../docs/tosspayments-review-evidence-checklist.md', import.meta.url),
  'utf8'
)

test('operations runbook keeps payments fail-closed until external gates pass', () => {
  assert.match(operations, /PAYMENTS_ENABLED=false/)
  assert.match(operations, /보증보험/)
  assert.match(operations, /월 정산한도/)
  assert.match(operations, /하나카드/)
  assert.match(operations, /회원 전용 결제/)
  assert.match(operations, /기존 유상 크레딧/)
})

test('operations runbook documents webhook and bounded reconciliation', () => {
  assert.match(operations, /TOSS_WEBHOOK_TOKEN/)
  assert.match(operations, /PAYMENT_STATUS_CHANGED/)
  assert.match(operations, /CRON_SECRET/)
  assert.match(operations, /"limit":50/)
  assert.match(operations, /웹훅 본문의 결제 상태만 신뢰하지 않는다/)
})

test('review checklist maps all requested point-charge evidence', () => {
  assert.match(evidence, /1회 10만원 한도/)
  assert.match(evidence, /1년 이용·환불가능기간 상한/)
  assert.match(evidence, /원 결제수단 환불/)
  assert.match(evidence, /사용자 간 양도 불가/)
  assert.match(evidence, /충전 경로/)
  assert.match(evidence, /사용 경로/)
  assert.match(evidence, /결제수단 제한/)
})

test('review checklist includes public routes and activation gate', () => {
  for (const route of [
    '/pricing',
    '/terms/service',
    '/terms/refund',
    '/checkout?planId={상품ID}',
    '/mypage/credits',
    '/mypage/payments',
  ]) {
    assert.ok(evidence.includes(route), `${route} evidence is required`)
  }

  assert.match(evidence, /PAYMENTS_ENABLED=true/)
  assert.match(evidence, /책임자 승인/)
})
