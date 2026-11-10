import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

function readSql(dir, suffix) {
  const dirUrl = new URL(`../supabase/${dir}/`, import.meta.url)
  const filename = readdirSync(dirUrl).find((name) => name.endsWith(suffix))

  return filename ? readFileSync(new URL(filename, dirUrl), 'utf8') : ''
}

const migration = readSql('migrations', '_payment_integrity_fixes.sql')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const rollback = readSql('rollback', '_payment_integrity_fixes_down.sql')
const rollbackCode = rollback.replace(/--[^\n]*/g, '')

const redefined = [
  'record_payment_alert',
  'enforce_payment_reconciliation_health',
  'process_payapp_cancellation',
  'complete_manual_point_charge_refund',
  'apply_payapp_feedback',
  'claim_point_charge_refund',
  'start_payment_reconciliation_run',
  'claim_payment_reconciliation_batch',
]

const ALERT_KEY_EXPRESSION =
  "(code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', '')))"
const NEW_CONFLICT_TARGET = `ON CONFLICT ${ALERT_KEY_EXPRESSION} WHERE resolved_at IS NULL`
const OLD_CONFLICT_TARGET = /on\s+conflict\s*\(\s*code\s*\)/i
const ORIGINAL_TRIGGER_DEF =
  'CREATE TRIGGER update_payment_orders_updated_at BEFORE UPDATE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'

// pg_get_functiondef 원문 단위로 자른다(머리부터 $function$까지, 줄바꿈 포함).
function functionDef(sql, name) {
  const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))
  assert.notEqual(start, -1, `${name} is defined`)
  const end = sql.indexOf('\n$function$;', start)
  assert.notEqual(end, -1, `${name} body ends`)
  return sql.slice(start, end) + '\n$function$\n'
}

function functionHeader(def) {
  return def.slice(0, def.indexOf('AS $function$'))
}

function count(text, needle) {
  return text.split(needle).length - 1
}

function md5(text) {
  return createHash('md5').update(text, 'utf8').digest('hex')
}

function expectedMd5s() {
  const values = {}
  for (const name of redefined) {
    const match = rollback.match(new RegExp(`^--\\s+${name}\\s+([0-9a-f]{32})$`, 'm'))
    assert.ok(match, `${name} md5 header comment`)
    values[name] = match[1]
  }
  return values
}

test('migration 1 runs in one bounded transaction without CASCADE or anon grants', () => {
  assert.ok(migration, 'migration file exists')
  assert.match(migrationCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.doesNotMatch(migrationCode, /\bCASCADE\b/i)
  assert.doesNotMatch(migrationCode, /^\s*(BEGIN|COMMIT)\s*;/im)
  assert.doesNotMatch(migrationCode, /GRANT[^;]*TO[^;]*\b(anon|authenticated)\b/i)
})

test('precheck compares all eight definitions, the old alert index and the trigger before any change', () => {
  const precheckEnd = migrationCode.indexOf('$$;')
  const precheck = migrationCode.slice(0, precheckEnd)
  const md5s = expectedMd5s()
  for (const name of redefined) {
    assert.ok(precheck.includes(`('${name}', 'public.${name}(`), `${name} is prechecked`)
    assert.ok(precheck.includes(`'${md5s[name]}')`), `${name} precheck md5 matches the rollback original`)
  }
  assert.match(precheck, /md5\(pg_get_functiondef\(to_regprocedure\(v_check\.signature\)\)\) IS DISTINCT FROM v_check\.expected_md5/)
  assert.match(precheck, /RAISE EXCEPTION 'PAYMENT_INTEGRITY_PRECHECK: % definition drifted'/)
  assert.match(precheck, /to_regclass\('public\.payment_reconciliation_alerts_active_code_key'\) IS NULL/)
  assert.ok(precheck.includes('pg_get_triggerdef(t.oid)'), 'trigger definition is compared')
  assert.ok(precheck.includes(`IS DISTINCT FROM '${ORIGINAL_TRIGGER_DEF}'`), 'trigger definition literal')

  const firstChange = Math.min(
    migrationCode.indexOf('CREATE FUNCTION'),
    migrationCode.indexOf('CREATE OR REPLACE'),
    migrationCode.indexOf('CREATE INDEX'),
    migrationCode.indexOf('DROP INDEX')
  )
  assert.ok(precheckEnd < firstChange, 'precheck runs before any change')
})

test('redefined functions keep SECURITY DEFINER and the pinned search_path; only the trigger function is invoker', () => {
  const names = [...migrationCode.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(names.sort(), [...redefined].sort(), 'exactly the eight planned functions are redefined')

  for (const name of redefined) {
    const def = functionDef(migration, name)
    assert.match(def, /\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\nAS \$function\$/, name)
    // 인자·반환형이 운영 원문과 같다.
    assert.equal(functionHeader(def), functionHeader(functionDef(rollback, name)), `${name} signature unchanged`)
  }

  const trigger = functionDef(migration, 'payment_orders_touch_updated_at')
  assert.match(trigger, /RETURNS trigger\n LANGUAGE plpgsql\n SECURITY INVOKER\n SET search_path TO 'public', 'pg_temp'/)
  assert.doesNotMatch(trigger, /SECURITY DEFINER/)
  assert.ok(
    migrationCode.includes('REVOKE ALL ON FUNCTION public.payment_orders_touch_updated_at() FROM PUBLIC, anon, authenticated;')
  )
  assert.doesNotMatch(migrationCode, /GRANT[^;]*payment_orders_touch_updated_at/)
})

test('locks follow payment_orders -> runs -> alerts and the trigger is replaced in place', () => {
  const triggerAt = migrationCode.indexOf('CREATE OR REPLACE TRIGGER update_payment_orders_updated_at')
  const runsIndexAt = migrationCode.indexOf('CREATE INDEX payment_reconciliation_runs_running_idx')
  const backfillAt = migrationCode.indexOf("SET status = 'failed'")
  const dropAlertIndexAt = migrationCode.indexOf('DROP INDEX public.payment_reconciliation_alerts_active_code_key;')
  for (const at of [triggerAt, runsIndexAt, backfillAt, dropAlertIndexAt]) assert.notEqual(at, -1)
  assert.ok(triggerAt < runsIndexAt && runsIndexAt < backfillAt && backfillAt < dropAlertIndexAt)
  assert.ok(dropAlertIndexAt < migrationCode.indexOf('CREATE OR REPLACE FUNCTION'), 'functions follow the index swap')

  assert.doesNotMatch(migrationCode, /DROP TRIGGER/i)
  assert.match(
    migrationCode,
    /CREATE OR REPLACE TRIGGER update_payment_orders_updated_at\n\s+BEFORE UPDATE ON public\.payment_orders\n\s+FOR EACH ROW EXECUTE FUNCTION public\.payment_orders_touch_updated_at\(\);/
  )
})

test('alert dedupe index uses order, mul_no and dedupe_key and every ON CONFLICT targets it', () => {
  assert.ok(migrationCode.includes('DROP INDEX public.payment_reconciliation_alerts_active_code_key;'))
  assert.ok(
    migrationCode.includes(
      `CREATE UNIQUE INDEX payment_reconciliation_alerts_active_key\n  ON public.payment_reconciliation_alerts ${ALERT_KEY_EXPRESSION}\n  WHERE resolved_at IS NULL;`
    )
  )
  assert.match(ALERT_KEY_EXPRESSION, /details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''/)

  assert.doesNotMatch(migration, OLD_CONFLICT_TARGET)
  const allConflicts = [...migrationCode.matchAll(/^\s*(ON CONFLICT[^\n]*)/gm)].map((m) => m[1])
  assert.equal(allConflicts.length, 8, 'record_payment_alert 1 + health 7')
  for (const line of allConflicts) assert.equal(line, `${NEW_CONFLICT_TARGET} DO NOTHING;`)

  const health = functionDef(migration, 'enforce_payment_reconciliation_health')
  assert.equal(count(health, NEW_CONFLICT_TARGET), 7, 'health has exactly seven new conflict targets')
  assert.equal(count(functionDef(migration, 'record_payment_alert'), NEW_CONFLICT_TARGET), 1)

  // 사후 점검은 literal이 아니라 같은 정규식으로 본다.
  const postcheck = migrationCode.slice(migrationCode.lastIndexOf('DO $$'))
  assert.ok(postcheck.includes("pg_get_functiondef(p.oid) ~* 'on\\s+conflict\\s*\\(\\s*code\\s*\\)'"))
  assert.match(postcheck, /status = 'running' AND lease_expires_at <= now\(\)/)
  assert.match(postcheck, /NOT p\.prosecdef/)
  assert.match(postcheck, /'search_path=public, pg_temp' = ANY \(p\.proconfig\)/)
  for (const name of redefined) assert.ok(postcheck.includes(`'${name}'`), `${name} properties are post-checked`)
})

test('health keeps the kakao NOT EXISTS insert and the sale-stop decision unchanged', () => {
  const health = functionDef(migration, 'enforce_payment_reconciliation_health')
  const original = functionDef(rollback, 'enforce_payment_reconciliation_health')

  const kakaoInsert = (def) => {
    const start = def.indexOf('    INSERT INTO public.payment_reconciliation_alerts (\n      code,')
    assert.notEqual(start, -1)
    return def.slice(start, def.indexOf('    );\n  END IF;', start))
  }
  assert.equal(kakaoInsert(health), kakaoInsert(original))
  assert.match(kakaoInsert(health), /WHERE NOT EXISTS \(/)

  const disable = (def) => {
    const start = def.indexOf('  v_payapp_disable := ')
    return def.slice(start, def.indexOf(';', start) + 1)
  }
  assert.equal(disable(health), disable(original))

  const stopUpdate = (def) => {
    const start = def.indexOf('  IF v_payapp_disable THEN')
    return def.slice(start, def.indexOf('  END IF;', start))
  }
  assert.equal(stopUpdate(health), stopUpdate(original))
  assert.doesNotMatch(stopUpdate(health), /feedback/)
})

test('health records each payapp money condition separately', () => {
  const health = functionDef(migration, 'enforce_payment_reconciliation_health')
  for (const [condition, code] of [
    ['v_payapp_unfulfilled_count > 0', 'PAYAPP_PAID_UNFULFILLED'],
    ['v_payapp_cancel_active_count > 0', 'PAYAPP_CANCEL_UNPROCESSED'],
    ['v_payapp_money_review_count > 0', 'PAYAPP_MONEY_RISK_REVIEW'],
  ]) {
    const block = new RegExp(
      `IF ${condition} THEN\\n\\s+INSERT INTO public\\.payment_reconciliation_alerts \\(code, severity, message, details\\)\\n\\s+VALUES \\(\\n\\s+'${code}',\\n\\s+'critical',`
    )
    assert.match(health, block, code)
  }
  assert.doesNotMatch(health, /v_payapp_message/)
  assert.doesNotMatch(health, /VALUES \(\n\s+v_payapp_code,/)
})

test('health alerts on unprocessed payapp feedback without stopping sales', () => {
  const health = functionDef(migration, 'enforce_payment_reconciliation_health')
  const start = health.indexOf("WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';")
  assert.notEqual(start, -1, 'ack query')
  assert.match(health, /SELECT MAX\(\(details->>'latest_received_at'\)::timestamptz\)\n\s+INTO v_feedback_ack/)
  const query = health.slice(start, health.indexOf("VALUES ('PAYAPP_FEEDBACK_UNPROCESSED'"))
  assert.equal(count(query, "pwe.transmission_id LIKE 'payapp:%'"), 2)
  assert.equal(count(query, "pwe.received_at <= now() - interval '30 minutes'"), 2)
  assert.equal(count(query, "pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)"), 2)
  assert.match(query, /pwe\.processing_status IN \('pending', 'failed'\)/)
  assert.match(query, /COALESCE\(pwe\.last_error_code, ''\) NOT LIKE 'PROCESS:%'/)
  assert.match(query, /UNION ALL/)
  assert.match(query, /pwe\.processing_status = 'ignored'/)
  assert.ok(
    query.includes(
      "pwe.event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')"
    )
  )
  assert.match(query, /COALESCE\(pwe\.last_error_code, ''\) <> 'PAYAPP_FOREIGN_FEEDBACK'/)
  assert.match(health, /'latest_received_at', v_feedback_latest/)

  assert.ok(
    migrationCode.includes(
      "CREATE INDEX payment_webhook_events_ignored_cancel_idx\n  ON public.payment_webhook_events (received_at)\n  WHERE processing_status = 'ignored'\n    AND event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71');"
    )
  )
})

test('process_payapp_cancellation records follow-up alerts after the inner exception block', () => {
  const def = functionDef(migration, 'process_payapp_cancellation')
  const innerEnd = def.indexOf('      v_result := NULL;\n  END;\n')
  assert.notEqual(innerEnd, -1, 'inner EXCEPTION block end')
  const firstAlert = def.indexOf('PERFORM public.record_payment_alert(')
  assert.ok(firstAlert > innerEnd, 'alerts are recorded outside the inner EXCEPTION block')

  for (const code of [
    'PAYAPP_DOUBLE_REFUND_SUSPECTED',
    'PAYAPP_CANCEL_AFTER_QUARANTINE',
    'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL',
    'PAYAPP_PARTIAL_CANCEL_ABSORBED',
    'PAYAPP_PARTIAL_CANCEL_DEFERRED',
    'PAYAPP_CANCEL_HANDLING_FAILED',
  ]) {
    const at = def.indexOf(`'${code}'`, innerEnd)
    assert.ok(at > innerEnd, `${code} is recorded after the inner block`)
  }
  assert.equal(count(def, 'PERFORM public.record_payment_alert('), 2, 'normal path and fallback path')

  const fallback = def.indexOf("'PAYAPP_CANCEL_HANDLING_FAILED',\n    'critical',")
  assert.ok(fallback > def.indexOf('-- 실패 대체 처리'), 'handling-failed alert is in the fallback path')
  assert.ok(fallback < def.lastIndexOf("'result', 'cancel_handling_failed'"), 'before the fallback RETURN')
  assert.match(def.slice(fallback, def.lastIndexOf('RETURN jsonb_build_object(')), /'error_state', v_error_state/)

  assert.match(
    def,
    /WHEN v_result = 'external_cancel_quarantined'\n\s+AND v_ppt\.paid_feedback_recorded_at IS NULL\n\s+AND v_ppt\.admin_paid_confirmed_at IS NOT NULL THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'/
  )
  assert.match(
    def,
    /IF v_result = 'external_cancel_quarantined' THEN\n\s+v_alert_details := v_alert_details \|\| jsonb_build_object\('reason', 'admin_confirmed_mul_no_unverified'\);/
  )
  assert.match(def, /WHEN v_alert_code IN \('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'PAYAPP_CANCEL_AFTER_QUARANTINE'\) THEN 'critical' ELSE 'warning'/)
  assert.match(def, /'payment_order_id', v_order\.id, 'source', 'process_payapp_cancellation'\)\n\s+\|\| \(COALESCE\(v_detail, '\{\}'::jsonb\) - 'request_id' - 'user_id'\)/)

  // TS 경보와 같은 (code, payment_order_id) 키로 합쳐지는 근거.
  const normalReturn = def.slice(def.indexOf('    RETURN jsonb_build_object(\n      \'result\', v_result,'))
  assert.match(normalReturn, /'payment_order_id', v_order\.id,/)
})

test('process_payapp_cancellation does not auto-complete admin-confirmed payments', () => {
  const def = functionDef(migration, 'process_payapp_cancellation')
  const guard = def.indexOf(
    "ELSIF v_request.id IS NOT NULL\n            AND v_request.status = 'manual_review' AND v_request.origin = 'user'\n            AND v_ppt.paid_feedback_recorded_at IS NULL\n            AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN"
  )
  assert.notEqual(guard, -1, 'admin-confirmed guard')
  assert.ok(guard > def.indexOf("v_request.origin IN ('external_cancel', 'partial_cancel') THEN"), 'after the quarantine check')
  assert.ok(guard < def.indexOf('public.finalize_point_charge_refund('), 'before finalize')
  const branch = def.slice(guard, def.indexOf('ELSIF', guard + 5))
  assert.match(branch, /v_result := 'already_quarantined';/)
  assert.match(branch, /v_detail := jsonb_build_object\('reason', 'admin_confirmed_mul_no_unverified'\);/)
})

test('complete_manual forces full recovery after a full cancel and flags bank transfer after another method', () => {
  const def = functionDef(migration, 'complete_manual_point_charge_refund')
  assert.match(def, /v_partial := v_ppt\.cancel_feedback_recorded_at IS NULL\n\s+AND COALESCE\(/)

  const completed = def.slice(def.indexOf("IF v_request.status = 'completed' THEN"), def.indexOf("IF v_request.status <> 'manual_review' THEN"))
  assert.match(completed, /IF p_external_method = 'bank_transfer' AND NOT EXISTS \(/)
  assert.match(completed, /paa\.refund_request_id = v_request\.id/)
  assert.match(completed, /paa\.action = 'manual_refund_completed'/)
  assert.match(completed, /paa\.external_method = 'bank_transfer'\) THEN/)
  assert.match(completed, /record_payment_alert\('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'critical',/)
  assert.match(completed, /'dedupe_key', 'refund_request:' \|\| v_request\.id::text/)
  assert.match(completed, /'double_refund_suspected', v_double\)/)
})

test('apply_payapp_feedback accepts the residual price only when the price is present', () => {
  const def = functionDef(migration, 'apply_payapp_feedback')
  assert.match(
    def,
    /ELSIF p_pay_state IN \(9, 64\)\n\s+AND p_price IS DISTINCT FROM v_order\.expected_amount\n\s+AND NOT \(p_price IS NOT NULL\n\s+AND v_ppt\.partial_cancel_amount IS NOT NULL\n\s+AND p_price = v_order\.expected_amount - v_ppt\.partial_cancel_amount\) THEN\n\s+v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';/
  )
})

test('claim sends admin-confirmed payapp refunds to manual review before processing', () => {
  const def = functionDef(migration, 'claim_point_charge_refund')
  const branch = def.indexOf(
    'IF v_provider_transaction.paid_feedback_recorded_at IS NULL\n       AND v_provider_transaction.admin_paid_confirmed_at IS NOT NULL THEN'
  )
  assert.notEqual(branch, -1)
  assert.ok(branch > def.indexOf("IF v_order.provider = 'payapp' THEN"))
  assert.ok(branch < def.indexOf("SET status = 'processing'"), 'before the processing update')
  const body = def.slice(branch, def.indexOf("SET status = 'processing'"))
  assert.match(body, /SET status = 'manual_review',/)
  assert.match(body, /last_error_code = 'PAYAPP_ADMIN_CONFIRMED_MANUAL_REFUND'/)
  assert.match(body, /'manual_review_required', true/)
  assert.match(body, /'provider_transaction_id', NULL/)
})

test('start run closes abandoned runs and counts only the previous lease owner', () => {
  const def = functionDef(migration, 'start_payment_reconciliation_run')
  const close = def.indexOf("last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED'")
  assert.ok(close > def.indexOf('PAYMENT_RECONCILIATION_LEASE_HELD'), 'after the lease-held branch')
  assert.match(def, /WHERE status = 'running' AND lease_expires_at <= v_now;/)
  assert.match(def, /v_abandoned := v_scheduler\.lease_owner IS NOT NULL AND EXISTS \(/)
  assert.match(def, /WHERE id = v_scheduler\.lease_owner AND last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED' AND completed_at = v_now\)/)
  assert.match(def, /consecutive_failures = consecutive_failures \+ CASE WHEN v_abandoned THEN 1 ELSE 0 END,/)
  assert.match(def, /last_error_code = CASE WHEN v_abandoned THEN 'PAYMENT_RECONCILIATION_RUN_ABANDONED' ELSE last_error_code END,/)
})

test('backfill closes abandoned runs and the running index exists', () => {
  const backfillStart = migrationCode.indexOf('DO $$', migrationCode.indexOf('CREATE INDEX payment_webhook_events_ignored_cancel_idx'))
  const backfill = migrationCode.slice(backfillStart, migrationCode.indexOf('$$;', backfillStart + 5))
  assert.match(
    backfill,
    /UPDATE public\.payment_reconciliation_runs\n\s+SET status = 'failed',\n\s+completed_at = now\(\),\n\s+last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED',[\s\S]+?WHERE status = 'running' AND lease_expires_at <= now\(\);\n\n\s+GET DIAGNOSTICS v_closed = ROW_COUNT;\n\s+RAISE NOTICE/
  )
  assert.ok(
    migrationCode.includes(
      "CREATE INDEX payment_reconciliation_runs_running_idx\n  ON public.payment_reconciliation_runs (lease_expires_at)\n  WHERE status = 'running';"
    )
  )
  assert.doesNotMatch(backfill, /payment_reconciliation_scheduler/, 'backfill does not touch the scheduler')
})

test('the trigger function ignores reconcile bookkeeping columns and claim orders by last reconcile time', () => {
  const trigger = functionDef(migration, 'payment_orders_touch_updated_at')
  const columns =
    "ARRAY['updated_at','reconcile_attempt_count','next_reconcile_at','last_reconciled_at',\n"
  assert.equal(count(trigger, columns), 2)
  assert.equal(count(trigger, "'last_reconcile_error_code','last_reconcile_error_message']"), 2)
  assert.match(trigger, /NEW\.updated_at := OLD\.updated_at;/)
  assert.match(trigger, /NEW\.updated_at := now\(\);/)

  const claim = functionDef(migration, 'claim_payment_reconciliation_batch')
  assert.match(claim, /ORDER BY po\.last_reconciled_at ASC NULLS FIRST, po\.updated_at ASC, po\.id ASC/)
})

test('rollback prechecks run first and restore the old index, trigger and originals', () => {
  assert.ok(rollback, 'rollback file exists')
  assert.match(rollbackCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.doesNotMatch(rollbackCode, /\bCASCADE\b/i)
  assert.doesNotMatch(rollbackCode, /^\s*(BEGIN|COMMIT)\s*;/im)

  const precheckEnd = rollbackCode.indexOf('$$;')
  const precheck = rollbackCode.slice(0, precheckEnd)
  assert.match(precheck, /to_regprocedure\('public\.refund_credits\(uuid,integer,text,uuid,text,jsonb,integer\)'\)/)
  assert.match(precheck, /IS DISTINCT FROM '6a082ed597597efdbb688225076a3996'/)
  assert.match(precheck, /to_regprocedure\('public\.approve_market_refund\(uuid,uuid,text,integer\)'\) IS NOT NULL/)
  assert.match(precheck, /to_regprocedure\('public\.grant_admin_credits\(uuid,integer,text,text,text\)'\) IS NOT NULL/)
  assert.match(precheck, /RAISE EXCEPTION 'ROLLBACK_PRECHECK: roll back 20261110110000 first'/)
  assert.match(precheck, /WHERE resolved_at IS NULL\n\s+GROUP BY code\n\s+HAVING count\(\*\) > 1/)
  assert.match(precheck, /RAISE EXCEPTION 'ROLLBACK_PRECHECK: duplicate unresolved alerts per code/)
  const firstChange = Math.min(
    ...['CREATE OR REPLACE', 'DROP ', 'CREATE UNIQUE INDEX'].map((s) => rollbackCode.indexOf(s)).filter((i) => i >= 0)
  )
  assert.ok(precheckEnd < firstChange, 'prechecks run before any change')

  const triggerAt = rollbackCode.indexOf(
    'CREATE OR REPLACE TRIGGER update_payment_orders_updated_at\n  BEFORE UPDATE ON public.payment_orders\n  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();'
  )
  const dropTriggerFn = rollbackCode.indexOf('DROP FUNCTION public.payment_orders_touch_updated_at();')
  const dropRuns = rollbackCode.indexOf('DROP INDEX public.payment_reconciliation_runs_running_idx;')
  const dropEvents = rollbackCode.indexOf('DROP INDEX public.payment_webhook_events_ignored_cancel_idx;')
  const dropNew = rollbackCode.indexOf('DROP INDEX public.payment_reconciliation_alerts_active_key;')
  const createOld = rollbackCode.indexOf(
    'CREATE UNIQUE INDEX payment_reconciliation_alerts_active_code_key ON public.payment_reconciliation_alerts USING btree (code) WHERE (resolved_at IS NULL);'
  )
  for (const at of [triggerAt, dropTriggerFn, dropRuns, dropEvents, dropNew, createOld]) assert.notEqual(at, -1)
  assert.ok(triggerAt < dropTriggerFn && dropTriggerFn < dropRuns && dropRuns < dropNew && dropNew < createOld, 'payment_orders -> runs -> alerts')
  assert.ok(createOld < rollbackCode.indexOf('CREATE OR REPLACE FUNCTION'), 'old index exists before old functions')
})

test('rollback restores the eight production originals byte for byte', () => {
  const md5s = expectedMd5s()
  for (const name of redefined) {
    const def = functionDef(rollback, name)
    assert.equal(md5(def), md5s[name], `${name} original md5`)
    assert.ok(def.length > 700, `${name} original is not truncated`)
  }
  const names = [...rollbackCode.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1])
  assert.deepEqual(names.sort(), [...redefined].sort())
  // 원문은 옛 code 단위 대상을 쓴다(되돌린 인덱스와 짝).
  assert.equal(count(rollback, 'ON CONFLICT (code) WHERE resolved_at IS NULL DO NOTHING;'), 5)
})
