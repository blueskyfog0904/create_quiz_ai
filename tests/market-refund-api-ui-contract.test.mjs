import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const userRefundRoute = readFileSync(new URL('../src/app/api/market/refunds/route.ts', import.meta.url), 'utf8')
const adminRefundRoute = readFileSync(new URL('../src/app/api/admin/market/refunds/route.ts', import.meta.url), 'utf8')
const adminRefundItemRoute = readFileSync(new URL('../src/app/api/admin/market/refunds/[id]/route.ts', import.meta.url), 'utf8')
const marketRefunds = readFileSync(new URL('../src/lib/market-refunds.ts', import.meta.url), 'utf8')
const libraryClient = readFileSync(new URL('../src/app/(dashboard)/library/market/market-library-client.tsx', import.meta.url), 'utf8')
const marketItemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const adminRefundsPage = readFileSync(new URL('../src/app/(admin)/admin/refunds/page.tsx', import.meta.url), 'utf8')

test('user market refund API validates target and delegates request creation', () => {
  assert.match(userRefundRoute, /targetKind: z\.enum\(\['legacy_purchase', 'v2_order'\]\)/)
  assert.match(userRefundRoute, /requestMarketRefund/)
  assert.match(userRefundRoute, /UNAUTHORIZED/)
  assert.match(userRefundRoute, /ALREADY_DOWNLOADED|DOWNLOAD_EXISTS/)
})

test('admin market refund API lists and processes approvals and rejections', () => {
  assert.match(adminRefundRoute, /listMarketRefundRequestsForAdmin/)
  assert.match(adminRefundItemRoute, /approveMarketRefund/)
  assert.match(adminRefundItemRoute, /rejectMarketRefund/)
  assert.match(adminRefundItemRoute, /action: z\.enum\(\['approve', 'reject'\]\)/)
})

test('market refund service performs eligibility checks, stale approval recheck, and credit refund', () => {
  assert.match(marketRefunds, /export async function getMarketRefundEligibility/)
  assert.match(marketRefunds, /const isWithinRefundPeriod = new Date\(\) <= refundDeadline/)
  assert.match(marketRefunds, /downloadCount > 0 \|\| !isWithinRefundPeriod/)
  assert.match(marketRefunds, /구매 후 7일/)
  assert.match(marketRefunds, /CreditService\.refundCredits/)
  assert.match(marketRefunds, /승인 전 환불 조건/)
  assert.match(marketRefunds, /status: 'refunded'/)
})

test('market library exposes refund targets and a refund request dialog', () => {
  assert.match(marketItemsServer, /refundTargets/)
  assert.match(libraryClient, /환불 신청/)
  assert.doesNotMatch(libraryClient, /구매 후 7일 이내이거나 다운로드 이력이 없으면 환불 신청할 수 있습니다/)
  assert.doesNotMatch(libraryClient, /다운로드 URL이 발급된 경우 환불이 불가합니다/)
  assert.match(libraryClient, /event\.stopPropagation\(\)/)
  assert.match(libraryClient, /\/api\/market\/refunds/)
})

test('market library shows one inline refund button only when target is available', () => {
  assert.match(libraryClient, /const refundTarget = row\.refundTargets\.find\(\(target\) => target\.status === 'available'\)/)
  assert.doesNotMatch(libraryClient, /row\.refundTargets\.map\(\(target\)/)
  assert.doesNotMatch(libraryClient, /row\.refundTargets\.find\(\(target\) => target\.status === 'pending'\)/)
  assert.match(libraryClient, /flex items-center gap-2/)
  assert.match(libraryClient, /\{refundTarget && \(/)
  assert.match(libraryClient, /disabled=\{refundSubmitting === refundTarget\.targetId\}/)
  assert.doesNotMatch(libraryClient, /환불 심사중/)
})

test('admin refunds page includes separate market refund management panel', () => {
  assert.match(adminRefundsPage, /MarketRefundsClient/)
  assert.match(adminRefundsPage, /문제마켓 환불/)
})
