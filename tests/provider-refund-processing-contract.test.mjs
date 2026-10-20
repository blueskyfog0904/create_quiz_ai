import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migrationName = readdirSync(
  new URL('../supabase/migrations', import.meta.url)
).find((name) => name.endsWith('_add_provider_refund_processing.sql'))

const migration = migrationName
  ? read(`../supabase/migrations/${migrationName}`)
  : ''
const processor = read('../src/lib/point-charge-refund-processor.ts')
const kakaoServer = read('../src/lib/kakaopay-server.ts')
const payappServer = read('../src/lib/payapp-server.ts')
const adminRoute = read('../src/app/api/admin/refunds/route.ts')
const adminClient = read(
  '../src/app/(admin)/admin/refunds/refunds-client.tsx'
)

test('refund processor dispatches by the immutable stored provider', () => {
  assert.match(processor, /claimPointChargeRefund/)
  assert.match(processor, /claimed\.provider\s*===\s*'payapp'/)
  assert.match(processor, /claimed\.provider\s*===\s*'kakaopay'/)
  assert.match(processor, /getKakaoPayOrder/)
  assert.match(processor, /cancelPayAppPayment/)
  assert.match(processor, /cancelKakaoPayPayment/)
  assert.doesNotMatch(processor, /toss-payments-server|cancelTossPayment/)
  assert.match(processor, /finalizePointChargeRefund/)
})

// 페이앱은 결제 상태 조회 API가 없어 전취소 결과(state)로만 판단한다(계획 6.5).
test('provider status is queried before issuing a retryable cancellation', () => {
  const kakaoQuery = processor.indexOf('getKakaoPayOrder')
  const kakaoCancel = processor.indexOf('cancelKakaoPayPayment({')

  assert.ok(kakaoQuery >= 0)
  assert.ok(kakaoCancel > kakaoQuery)
  assert.match(processor, /status\s*===\s*'CANCEL_PAYMENT'/)
  assert.match(processor, /status\s*===\s*'PART_CANCEL_PAYMENT'/)
})

test('disabling new PayApp orders does not block refund recovery', () => {
  const cancel = payappServer.slice(
    payappServer.indexOf('export async function cancelPayAppPayment'),
    payappServer.indexOf('function safeEqual')
  )

  assert.match(cancel, /getPayAppConfig\('cancel'\)/)
  assert.doesNotMatch(cancel, /assertPayAppReady\(\)/)
})

test('Kakao full cancellation requires the original snapshot and cancel action', () => {
  assert.match(kakaoServer, /validateCompletedKakaoPayCancellation/)
  assert.match(kakaoServer, /payment\.status\s*!==\s*'CANCEL_PAYMENT'/)
  assert.match(kakaoServer, /payment\.cancel_available_amount\.total\s*!==\s*0/)
  assert.match(kakaoServer, /payment_action_type\s*===\s*'CANCEL'/)
  assert.match(kakaoServer, /payment\.canceled_amount\.tax_free/)
  assert.match(kakaoServer, /payment\.canceled_amount\.vat/)
})

test('database finalizer enforces provider cancellation status and unused source', () => {
  assert.match(migration, /create or replace function public\.finalize_point_charge_refund/i)
  assert.match(migration, /v_order\.provider\s*=\s*'toss'[\s\S]*p_provider_status\s*<>\s*'CANCELED'/i)
  assert.match(migration, /v_order\.provider\s*=\s*'kakaopay'[\s\S]*p_provider_status\s*<>\s*'CANCEL_PAYMENT'/i)
  assert.match(migration, /v_source\.status\s*<>\s*'pending_refund'/i)
  assert.match(
    migration,
    /v_source\.remaining_credits\s*<>\s*v_source\.initial_credits/i
  )
})

test('external provider cancellation atomically quarantines the credit source', () => {
  assert.match(
    migration,
    /create or replace function public\.quarantine_external_provider_cancellation/i
  )
  assert.match(migration, /from public\.credit_sources[\s\S]*for update/i)
  assert.match(migration, /set status\s*=\s*'pending_refund'/i)
  assert.match(migration, /status\s*=\s*'manual_review'/i)
  assert.match(migration, /EXTERNAL_PROVIDER_CANCELLATION/i)
  assert.match(
    migration,
    /revoke execute on function public\.quarantine_external_provider_cancellation[\s\S]*from public,\s*anon,\s*authenticated/i
  )
})

test('admin refund route and UI are provider-neutral', () => {
  assert.match(adminRoute, /processPointChargeRefund/)
  assert.doesNotMatch(adminRoute, /KAKAOPAY_REFUND_NOT_IMPLEMENTED/)
  assert.doesNotMatch(adminClient, /Toss 처리/)
  assert.doesNotMatch(adminClient, /Toss 취소 거래키/)
  assert.match(adminClient, /카카오페이/)
  // 결제수단 이름은 DB 라벨(payment_methods.label)에서 읽는다.
  assert.match(adminClient, /request\.order\?\.method\?\.label/)
})
