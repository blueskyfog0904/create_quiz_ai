import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// 토스 운영 문서 대신 페이앱·카카오페이 계획서와 운영 DB 체크리스트, 약관 기본값을 기준으로 확인한다.
const plan = readFileSync(
  new URL('../docs/payapp-kakaopay-payment-implementation-plan.md', import.meta.url),
  'utf8'
)
const checklist = readFileSync(
  new URL('../docs/payapp-db-migration-checklist.md', import.meta.url),
  'utf8'
)
const footerContent = readFileSync(
  new URL('../src/lib/footer-content.ts', import.meta.url),
  'utf8'
)

test('operations runbook keeps payments fail-closed until external gates pass', () => {
  assert.match(plan, /PAYMENTS_ENABLED/)
  assert.match(plan, /assertPayAppReady/)
  assert.match(plan, /payapp_accepts_new_orders/)
  assert.match(checklist, /미해소 경보가 0건이다/)
  assert.match(checklist, /실결제 시험/)
})

test('operations runbook documents webhook and bounded reconciliation', () => {
  assert.match(plan, /checkretry=y/)
  assert.match(plan, /SUCCESS/)
  assert.match(plan, /CRON_SECRET/)
  assert.match(plan, /결제 상태 조회 API가 없다/)
  assert.match(plan, /6\.3 대사/)
})

test('review checklist maps all requested point-charge evidence', () => {
  assert.match(footerContent, /1회[^\n]*100,000원/)
  assert.match(footerContent, /1년/)
  assert.match(footerContent, /원 결제수단/)
  assert.match(footerContent, /양도/)
  assert.match(footerContent, /충전 경로/)
  assert.match(footerContent, /사용 경로/)
  assert.match(footerContent, /그 밖의 결제수단은 지원하지 않습니다/)
})

test('review checklist includes public routes and activation gate', () => {
  for (const route of ['/pricing', '/checkout', '/mypage/credits', '/mypage/payments']) {
    assert.ok(footerContent.includes(route), `${route} evidence is required`)
  }

  assert.match(checklist, /payapp_accepts_new_orders=true/)
  assert.match(checklist, /사용자 승인/)
})
