import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const refundsRoute = read('../src/app/api/admin/refunds/route.ts')
const refundsClient = read('../src/app/(admin)/admin/refunds/refunds-client.tsx')
const refundsPage = read('../src/app/(admin)/admin/refunds/page.tsx')
const reviewRoute = read('../src/app/api/admin/payments/review/route.ts')
const reviewClient = read('../src/app/(admin)/admin/refunds/payment-review-client.tsx')
const refundsServer = read('../src/lib/point-charge-refunds-server.ts')

test('manual refund completion requires a note, an external method and the actual amount', () => {
  assert.match(refundsRoute, /action: z\.enum\(\['approve', 'reject', 'complete_manual'\]\)/)
  assert.match(refundsRoute, /externalMethod: z\.enum\(\['payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel'\]\)/)
  assert.match(refundsRoute, /refundAmount: z\.number\(\)\.int\(\)\.min\(1\)\.max\(100_000\)/)
  assert.match(refundsRoute, /if \(!input\.adminNote \|\| !input\.externalMethod \|\| !input\.refundAmount\)/)
  assert.match(refundsRoute, /completeManualPointChargeRefund\(/)
  // 이미 완료된 요청을 다시 완료해도 알림을 또 보내지 않는다.
  assert.match(refundsRoute, /if \(result\?\.user_id && !result\.already_completed\)/)
})

test('rejecting a manual review refund passes the provider-not-cancelled confirmation', () => {
  assert.match(refundsRoute, /providerNotCancelledConfirmed: input\.providerNotCancelledConfirmed \?\? false/)
  assert.match(refundsServer, /p_provider_not_cancelled_confirmed: input\.providerNotCancelledConfirmed/)
  assert.match(refundsServer, /REFUND_REJECT_CONFIRMATION_REQUIRED: '수동 확인 환불을 거절하려면 결제사 미취소 확인과 처리 메모가 모두 필요합니다\.'/)
})

test('the admin refund list offers manual completion and confirmed rejection for manual review', () => {
  assert.match(refundsClient, /request\.status === 'manual_review' \? \(/)
  assert.match(refundsClient, /openProcessDialog\(request, 'complete_manual'\)/)
  // 격리 건(결제사 취소·부분취소)은 거절할 수 없다.
  assert.match(refundsClient, /\{request\.origin === 'user' && \(/)
  assert.match(refundsClient, /결제사 관리자에서 이 결제가 취소되지 않았음을 확인했습니다/)
  // 수동 확인 환불 거절은 미취소 확인과 메모가 모두 있어야 버튼이 켜진다.
  assert.match(refundsClient, /\(providerNotCancelledConfirmed && adminNote\.trim\(\)\.length > 0\)/)
  assert.match(refundsClient, /페이앱 관리자에서 취소 요청\(정산금 반환\) 또는 고객 계좌 송금을 마친 뒤 완료 처리하세요/)
  // 부분취소 건은 회수량이 필수이고 환불액을 미리 채우지 않는다. 그 밖의 건은 회수량을 보내지 않는다.
  assert.match(refundsClient, /\.\.\.\(selectedRequiresRecovery\s*\? \{ recoveredCredits: Number\(recoveredCredits\) \}\s*: \{\}\)/)
  assert.match(refundsClient, /!requiresRecovery\(request\) && request\.refund_amount/)
  assert.match(refundsClient, /isWholeNumberBetween\(refundAmount, 1, maxRefundAmount\)/)
  assert.match(refundsPage, /partial_cancel_feedback_recorded_at/)
  assert.match(refundsClient, /request\.order\?\.method\?\.label/)
  assert.match(refundsPage, /method:payment_methods!payment_orders_payment_method_fkey\(label\)/)
  assert.match(refundsClient, /결제사 부분취소 확인 중/)
})

test('payment review resolves manual review orders through the audited RPC only', () => {
  assert.match(reviewRoute, /profile\?\.is_admin/)
  assert.match(reviewRoute, /action: z\.enum\(\['paid_confirmed', 'unpaid_confirmed', 'cancel_handled'\]\)/)
  assert.match(reviewRoute, /note: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(500\)/)
  assert.match(reviewRoute, /admin\.rpc\('resolve_payment_order_review'/)
  assert.match(reviewRoute, /p_actor_id: adminCheck\.user\.id/)
  assert.doesNotMatch(reviewRoute, /from\('payment_orders'\)\s*\.update/)
  assert.match(reviewRoute, /input\.action === 'paid_confirmed' && result\?\.status === 'completed' && result\.user_id/)
})

test('the payment review screen lists manual review orders and unresolved alerts', () => {
  assert.match(refundsPage, /\.from\('payment_orders'\)[\s\S]*?\.eq\('status', 'manual_review'\)/)
  assert.match(refundsPage, /\.from\('payment_reconciliation_alerts'\)[\s\S]*?\.is\('resolved_at', null\)/)
  assert.match(refundsPage, /<PaymentReviewClient/)
  // 가능한 처리는 서버에서 DB 가드와 같은 기준으로 정한다.
  assert.match(refundsPage, /allowedActions: allowedReviewActions\(\{/)
  assert.match(reviewClient, /\(selectedOrder\?\.allowedActions \?\? \[\]\)\.map/)
  assert.match(reviewClient, /order\.allowedActions\.length > 0/)
  assert.match(reviewClient, /action === 'cancel_handled' \? \{ externalMethod \}/)
  assert.match(reviewClient, /note\.trim\(\)\.length === 0/)
})

const alertsRoute = read('../src/app/api/admin/payments/alerts/route.ts')
const alertMigration = read('../supabase/migrations/20261020090000_payment_alert_resolution.sql')

test('alerts are resolved by an admin with a note through the audited RPC', () => {
  assert.match(alertsRoute, /profile\?\.is_admin/)
  assert.match(alertsRoute, /note: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(500\)/)
  assert.match(alertsRoute, /admin\.rpc\('resolve_payment_alert'/)
  assert.match(alertsRoute, /p_actor_id: adminCheck\.user\.id/)
  assert.doesNotMatch(alertsRoute, /actorId/)
  assert.doesNotMatch(alertsRoute, /from\('payment_reconciliation_alerts'\)/)

  assert.match(alertMigration, /'alert_resolved'/)
  assert.match(alertMigration, /REVOKE ALL ON FUNCTION public\.resolve_payment_alert\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/)
  assert.match(alertMigration, /'alert_message', v_alert\.message/)
  // 경보를 해소해도 판매 스위치는 바꾸지 않는다.
  assert.doesNotMatch(alertMigration, /payment_runtime_config/)

  assert.match(reviewClient, /fetch\('\/api\/admin\/payments\/alerts'/)
  assert.match(reviewClient, /alertNote\.trim\(\)\.length === 0/)
  assert.match(reviewClient, /아래 주문 목록에서 확인 처리하면 경보도 함께 해소됩니다/)
  // 처리할 조치가 없는 격리 주문은 경보가 자동 해소되지 않는다고 안내한다.
  assert.match(reviewClient, /orders\.filter\(\(order\) => order\.allowedActions\.length > 0\)/)
  assert.match(reviewClient, /수동 환불을 완료한 뒤 이 경보를 직접 해소하세요/)
})
