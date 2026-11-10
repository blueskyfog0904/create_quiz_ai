import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const base = read('../supabase/migrations/20261110100000_payment_integrity_fixes.sql')
const migration = read('../supabase/migrations/20261110115000_cancel_alert_admin_confirmed_message.sql')
const rollback = read('../supabase/rollback/20261110115000_cancel_alert_admin_confirmed_message_down.sql')
const webhook = read('../src/lib/payapp-webhook-server.ts')

const OLD_LINE =
  "          WHEN 'PAYAPP_CANCEL_AFTER_QUARANTINE' THEN '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.'"
const NEW_LINES = [
  "          WHEN 'PAYAPP_CANCEL_AFTER_QUARANTINE' THEN",
  "            CASE WHEN v_alert_details->>'reason' = 'admin_confirmed_mul_no_unverified'",
  "              THEN '관리자가 결제확인한 결제가 페이앱에서 승인취소되었습니다. 이 사이트 결제의 취소인지 페이앱 콘솔과 먼저 대조하세요.'",
  "              ELSE '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.'",
  '            END',
].join('\n')

function processCancellationDef(sql) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.process_payapp_cancellation(p_payment_order_id uuid)')
  assert.notEqual(start, -1)
  const end = sql.indexOf('\n$function$;', start)
  assert.notEqual(end, -1)
  return sql.slice(start, end + '\n$function$;'.length)
}

const OLD_QUARANTINE_BRANCH = [
  "      ELSIF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN",
  "        v_result := 'already_quarantined';",
  '',
].join('\n')
const NEW_QUARANTINE_BRANCH = OLD_QUARANTINE_BRANCH + [
  '        -- 관리자 결제확인 주문에 부분취소가 먼저 와서 격리된 경우도 결제번호가 검증되지 않았다. 경보 문구를 콘솔 대조로 안내한다.',
  '        IF v_ppt.paid_feedback_recorded_at IS NULL AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN',
  "          v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');",
  '        END IF;',
  '',
].join('\n')

test('migration changes only the message CASE and the quarantined-request reason of process_payapp_cancellation', () => {
  const before = processCancellationDef(base)
  assert.equal(before.split(OLD_LINE).length, 2)
  assert.equal(before.split(OLD_QUARANTINE_BRANCH).length, 2)
  assert.equal(
    processCancellationDef(migration),
    before.replace(OLD_LINE, NEW_LINES).replace(OLD_QUARANTINE_BRANCH, NEW_QUARANTINE_BRANCH)
  )
  assert.equal(migration.match(/CREATE (OR REPLACE )?FUNCTION/g).length, 1)
  assert.doesNotMatch(migration, /\b(GRANT|REVOKE|DROP|ALTER)\b/)
})

test('migration is guarded by the applied definition md5 and verifies privileges after', () => {
  assert.match(migration, /IS DISTINCT FROM 'c96cf3e72c2adec8cc73c972977f5ea2' THEN\s+RAISE EXCEPTION 'CANCEL_ALERT_MESSAGE_PRECHECK/)
  assert.match(migration, /CANCEL_ALERT_MESSAGE_VERIFY: privileges/)
  assert.match(migration, /SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure\('public\.process_payapp_cancellation\(uuid\)'\)/)
  assert.match(migration, /position\('SET search_path TO ''public'', ''pg_temp''' IN v_def\) = 0/)
  assert.match(migration, /has_function_privilege\('anon', 'public\.process_payapp_cancellation\(uuid\)', 'EXECUTE'\)/)
  assert.match(migration, /SET LOCAL lock_timeout = '3s';/)
})

test('rollback restores the 20261110100000 definition exactly', () => {
  assert.equal(processCancellationDef(rollback), processCancellationDef(base))
  assert.match(rollback, /IS DISTINCT FROM 'c96cf3e72c2adec8cc73c972977f5ea2' THEN\s+RAISE EXCEPTION 'CANCEL_ALERT_MESSAGE_ROLLBACK_VERIFY/)
})

test('webhook admin notification uses the same messages as the DB alert', () => {
  for (const message of [
    '관리자가 결제확인한 결제가 페이앱에서 승인취소되었습니다. 이 사이트 결제의 취소인지 페이앱 콘솔과 먼저 대조하세요.',
    '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.',
  ]) {
    assert.ok(webhook.includes(`'${message}'`), message)
    assert.ok(migration.includes(`'${message}'`), message)
  }
  assert.match(webhook, /result\.reason === 'admin_confirmed_mul_no_unverified'/)
})
