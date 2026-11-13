import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261113180000_payment_sales_stop_resume.sql')
const rollback = read('supabase/rollback/20261113180000_payment_sales_stop_resume_down.sql')
const ops = read('supabase/ops/payment_sales_stop_resume.sql')
const route = read('src/app/api/admin/payments/sales-stop/route.ts')
const panel = read('src/components/admin/payment-sales-panel.tsx')
const statusLib = read('src/lib/payment-sales-status-server.ts')

// 자동 점검 함수의 가장 최근 정의(재개 조건의 기준)
const healthSource = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .filter((sql) => /CREATE OR REPLACE FUNCTION public\.enforce_payment_reconciliation_health\(\)/.test(sql))
  .at(-1)

const squash = (sql) => sql.replace(/\s+/g, ' ')
const functionBody = (name) => {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} 정의가 있어야 한다`)
  return migration.slice(start, migration.indexOf('$function$;', start))
}

test('재개 조건은 자동 점검이 페이앱 판매를 끄는 조건과 글자까지 같다', () => {
  const blockers = squash(functionBody('payapp_sales_resume_blockers'))
  const health = squash(healthSource)
  const conditions = [
    // 결제완료 뒤 10분 넘게 미지급
    `WHERE po.provider = 'payapp' AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes' AND po.source_id IS NULL AND ppt.cancel_feedback_recorded_at IS NULL AND ppt.partial_cancel_feedback_recorded_at IS NULL;`,
    // 돈이 걸린 수동 확인
    `WHERE po.provider = 'payapp' AND po.status = 'manual_review' AND po.failure_code IN ( 'PAYAPP_FEEDBACK_MISMATCH', 'PAYAPP_MUL_NO_CONFLICT', 'PAYAPP_PARTIAL_CANCEL', 'PAYAPP_READY_CANCEL_FAILED', 'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED', 'PAYAPP_CANCEL_HANDLING_FAILED' );`,
    // 취소 표식 미처리(크레딧 사용 가능)
    `WHERE po.provider = 'payapp' AND ( (ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes' AND ppt.cancel_processed_at IS NULL) OR (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes' AND ppt.partial_cancel_processed_at IS NULL) );`,
    // 점검 작업 멈춤
    `v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL AND ( v_scheduler.last_succeeded_at IS NULL OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes' );`,
  ]
  for (const condition of conditions) {
    assert.ok(health.includes(condition), `자동 점검에 조건이 있어야 한다: ${condition.slice(0, 60)}`)
    assert.ok(blockers.includes(condition), `재개 조건에 같은 조건이 있어야 한다: ${condition.slice(0, 60)}`)
  }
  assert.match(health, /v_payapp_scheduler_unhealthy := v_scheduler_stale OR v_scheduler\.consecutive_failures >= 3;/)
  // 끄는 조건의 목록도 고정한다. 자동 점검에 조건이 더해지면 여기서 실패하므로 재개 조건도 같이 고치게 된다.
  assert.ok(health.includes('v_payapp_disable := v_payapp_unfulfilled_count > 0 OR v_payapp_money_review_count > 0 OR v_payapp_cancel_active_count > 0 OR v_payapp_scheduler_unhealthy;'))
  assert.match(blockers, /v_scheduler_stale OR v_scheduler\.consecutive_failures >= 3/)
  assert.match(blockers, /COUNT\(\*\) FILTER \(WHERE cs\.status = 'active'\)::integer INTO v_payapp_cancel_active_count/)
})

test('재개는 막는 조건이 하나라도 있으면 거부하고, 이미 켜져 있거나 설정이 비면 켜지 않는다', () => {
  const resume = squash(functionBody('resume_payment_sales'))
  assert.match(resume, /FROM public\.payment_runtime_config WHERE id = true FOR UPDATE/)
  assert.match(resume, /RAISE EXCEPTION 'PAYMENT_SALES_ALREADY_ON'/)
  assert.match(resume, /IF btrim\(COALESCE\(v_config\.payapp_merchant_id, ''\)\) = '' THEN RAISE EXCEPTION 'PAYMENT_SALES_CONFIG_INCOMPLETE'/)
  // 페이앱 주문 경로가 보지 않는 값으로 재개를 막지 않는다.
  assert.doesNotMatch(resume, /v_config\.accepted_provider_environment/)
  for (const key of ['paid_unfulfilled_count', 'money_review_count', 'cancel_unprocessed_active_count']) {
    assert.ok(resume.includes(`(v_blockers ->> '${key}')::integer > 0`))
  }
  assert.ok(resume.includes(`(v_blockers ->> 'scheduler_unhealthy')::boolean`))
  assert.match(resume, /RAISE EXCEPTION 'PAYMENT_SALES_RESUME_BLOCKED' USING DETAIL = v_blockers::text/)
  // 검사가 스위치를 켜는 UPDATE보다 먼저다.
  assert.ok(resume.indexOf('PAYMENT_SALES_RESUME_BLOCKED') < resume.indexOf('UPDATE public.payment_runtime_config'))
  assert.doesNotMatch(migration, /kakaopay_accepts_new_orders/)
})

test('중지는 꺼져 있지 않을 때만 바꾸고 처리자·사유를 남긴다', () => {
  const stop = squash(functionBody('stop_payment_sales'))
  assert.match(stop, /p_scope NOT IN \('master', 'payapp'\)/)
  assert.match(stop, /RAISE EXCEPTION 'PAYMENT_SALES_REASON_REQUIRED'/)
  assert.match(stop, /AND \(\(p_scope = 'master' AND master_accepts_new_orders\) OR \(p_scope = 'payapp' AND payapp_accepts_new_orders\)\)/)
  assert.match(stop, /change_ticket = left\('MANUAL_STOP: ' \|\| btrim\(p_reason\), 500\)/)
})

test('권한: 중지만 service_role, 재개와 조건 조회는 SQL Editor 전용', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.stop_payment_sales\(text, text, text\) FROM PUBLIC, anon, authenticated;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.stop_payment_sales\(text, text, text\) TO service_role;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resume_payment_sales\(text, text, text\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.payapp_sales_resume_blockers\(\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.(resume_payment_sales|payapp_sales_resume_blockers)/)
  for (const fn of migration.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)) {
    assert.match(rollback, new RegExp(`DROP FUNCTION public\\.${fn[1]}\\(`))
  }
  for (const name of ['stop_payment_sales', 'resume_payment_sales', 'payapp_sales_resume_blockers']) {
    assert.ok(ops.includes(`public.${name}(`))
  }
})

test('중지 API: 관리자 확인 뒤 전체 스위치만 끄고, 처리자는 세션에서, 꺼진 것을 확인해야 성공', () => {
  assert.ok(route.indexOf('profile?.is_admin') < route.indexOf("rpc('stop_payment_sales'"))
  assert.match(route, /reason: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(300\)/)
  assert.match(route, /\}\)\.strict\(\)/)
  assert.match(route, /p_scope: 'master'/)
  assert.match(route, /p_changed_by: `admin:\$\{user\.email \? extractAdminLoginId\(user\.email\) : user\.id\}`/)
  assert.match(route, /error \|\| result\?\.master_accepts_new_orders !== false/)
  assert.doesNotMatch(route, /resume_payment_sales/)
})

test('화면: 상태를 읽지 못하면 판매 중으로 보이지 않고, 재개 버튼은 없다', () => {
  assert.match(statusLib, /error \|\| data\?\.length !== 1[\s\S]*?return null/)
  assert.match(statusLib, /acceptsNewOrders: row\.master_accepts_new_orders && row\.payapp_accepts_new_orders/)
  assert.ok(panel.indexOf('if (!status)') < panel.indexOf('충전 판매 중</span>'))
  assert.match(panel, /disabled=\{submitting \|\| reason\.trim\(\)\.length === 0\}/)
  assert.match(panel, /fetch\('\/api\/admin\/payments\/sales-stop'/)
  assert.doesNotMatch(panel, /resume/)
  for (const page of ['src/app/(admin)/admin/page.tsx', 'src/app/(admin)/admin/refunds/page.tsx']) {
    assert.match(read(page), /<PaymentSalesPanel status=\{salesStatus\} \/>/)
  }
})
