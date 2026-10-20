import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

function readMigration(suffix) {
  const migrationsUrl = new URL('../supabase/migrations/', import.meta.url)
  const filename = readdirSync(migrationsUrl).find((name) =>
    name.endsWith(`_${suffix}.sql`)
  )

  return filename
    ? readFileSync(new URL(filename, migrationsUrl), 'utf8')
    : ''
}

const migration = readMigration('payapp_migration_a')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const schedulerMigration = readMigration('add_provider_reconciliation_scheduler')

function squash(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function functionBody(sql, name) {
  const start = sql.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`)
  )
  assert.notEqual(start, -1, `${name} is defined`)
  const rest = sql.slice(start)
  const end = rest.search(/\n\$(?:function)?\$;/)
  assert.notEqual(end, -1, `${name} body ends`)
  return rest.slice(0, end)
}

function candidateCondition(body) {
  const start = body.indexOf('FROM public.payment_orders po')
  const end = body.search(/ORDER BY po\.updated_at|;\s*$/)
  return squash(body.slice(start, end === -1 ? undefined : end))
}

function kakaoHealthBlock(body) {
  const start = body.indexOf('SELECT COUNT(*)::integer\n    INTO v_stale_count')
  assert.notEqual(start, -1, 'kakao health block starts')
  const insertAt = body.indexOf('INSERT INTO public.payment_reconciliation_alerts', start)
  const end = body.indexOf('END IF;', insertAt)
  return squash(body.slice(start, end + 'END IF;'.length))
}

const createdFunctions = [
  ...migration.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)\(/g),
].map((match) => match[1])

const triggerFunctions = new Set([
  'prevent_payment_order_snapshot_update',
  'prevent_payment_provider_identifier_replacement',
  'prevent_refund_request_origin_change',
  'prevent_payment_admin_action_mutation',
])

test('migration A exists and runs in one bounded transaction', () => {
  assert.ok(migration.length > 0)
  assert.match(migration, /^SET LOCAL lock_timeout = '3s';/m)
  assert.match(migration, /^SET LOCAL statement_timeout = '60s';/m)
  assert.doesNotMatch(migrationCode, /\bCASCADE\b/)
  assert.doesNotMatch(migrationCode, /^\s*(BEGIN|COMMIT);\s*$/m)
  assert.match(migration, /NOTIFY pgrst, 'reload schema';\s*$/)
})

test('payment methods are database rows with server-only access', () => {
  assert.match(migration, /CREATE TABLE public\.payment_methods/)
  for (const code of ['card', 'kakaopay', 'naverpay', 'tosspay', 'phone']) {
    assert.match(migration, new RegExp(`\\('${code}', '`))
  }
  assert.match(migration, /ALTER TABLE public\.payment_methods ENABLE ROW LEVEL SECURITY/)
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.payment_methods FROM PUBLIC, anon, authenticated, service_role;/
  )
  assert.match(migration, /GRANT SELECT ON TABLE public\.payment_methods TO service_role;/)
  assert.match(
    migration,
    /FOREIGN KEY \(payment_method_code, provider\)\s+REFERENCES public\.payment_methods \(code, provider\)/
  )
  assert.match(migration, /CHECK \(provider <> 'payapp' OR payment_method_code IS NOT NULL\)/)
})

test('payapp is added to every provider check and the snapshot check pins live VAT orders', () => {
  for (const constraint of [
    'payment_orders_provider_check',
    'checkout_attempts_claimed_provider_check',
    'payment_provider_transactions_provider_check',
    'refund_requests_provider_check',
    'payment_reconciliation_items_provider_check',
  ]) {
    assert.match(
      migration,
      new RegExp(`ADD CONSTRAINT ${constraint}\\s+CHECK \\(\\w+ IN \\('toss', 'kakaopay', 'payapp'\\)\\)`)
    )
  }
  assert.match(
    migration,
    /provider = 'payapp'\s+AND mid IS NULL\s+AND provider_environment = 'live'\s+AND tax_free_amount = 0\s+AND vat_amount IS NOT NULL/
  )
  assert.match(migration, /ALTER COLUMN provider DROP DEFAULT/)
})

test('prepare_payment_order is replaced without an overload and names every provider branch', () => {
  assert.match(
    migration,
    /DROP FUNCTION public\.prepare_payment_order\(\s*uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text,\s*timestamp with time zone, integer, integer, text\s*\);/
  )
  const body = functionBody(migration, 'prepare_payment_order')
  assert.match(body, /p_payment_method_code text DEFAULT NULL/)
  assert.match(body, /WHEN p_provider IN \('kakaopay', 'payapp'\) THEN 'preparing'/)
  assert.match(body, /WHEN p_provider = 'toss' THEN 'ready'/)
  assert.doesNotMatch(body, /\bELSE\b/)
})

test('payment and cancel markers become immutable once recorded', () => {
  const body = functionBody(migration, 'prevent_payment_provider_identifier_replacement')
  for (const column of [
    'paid_feedback_recorded_at',
    'paid_amount',
    'cancel_feedback_recorded_at',
    'partial_cancel_feedback_recorded_at',
    'admin_paid_confirmed_at',
    'provider_paid_at',
    'cancel_processed_at',
    'partial_cancel_processed_at',
  ]) {
    assert.match(
      body,
      new RegExp(`OLD\\.${column} IS NOT NULL\\s+AND NEW\\.${column} IS DISTINCT FROM OLD\\.${column}`)
    )
  }
  assert.match(
    functionBody(migration, 'prevent_payment_order_snapshot_update'),
    /NEW\.payment_method_code IS DISTINCT FROM OLD\.payment_method_code/
  )
})

test('refund request origin only moves from user to a quarantine origin', () => {
  const body = functionBody(migration, 'prevent_refund_request_origin_change')
  assert.match(body, /OLD\.origin = 'user'\s+AND NEW\.origin IN \('external_cancel', 'partial_cancel'\)/)
  assert.match(migration, /CREATE TRIGGER prevent_refund_request_origin_change\s+BEFORE UPDATE OF origin ON public\.refund_requests/)
  assert.doesNotMatch(migration, /origin = 'external_cancel'\s*,?\s*\n\s*WHERE/)
})

test('refund idempotency key is unique only among open refund requests', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX refund_requests_cancel_idempotency_key\s+ON public\.refund_requests \(cancel_idempotency_key\)\s+WHERE cancel_idempotency_key IS NOT NULL\s+AND status IN \('pending_review', 'processing', 'retryable_failed', 'manual_review'\)/
  )
})

test('payment admin actions are append-only', () => {
  assert.match(migration, /CREATE TABLE public\.payment_admin_actions/)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.payment_admin_actions/)
  assert.match(migration, /BEFORE TRUNCATE ON public\.payment_admin_actions/)
  assert.doesNotMatch(migration, /REFERENCES public\.(payment_orders|refund_requests|profiles)\s*\(id\)[^;]*payment_admin_actions/)
})

test('payapp cancel feedback only touches the provider transaction row', () => {
  const body = functionBody(migration, 'apply_payapp_feedback')
  const markerStart = body.indexOf('IF v_is_marker THEN')
  const markerEnd = body.indexOf('-- 2. 그 밖의 상태')
  assert.ok(markerStart > 0 && markerEnd > markerStart)
  const markerPath = body.slice(markerStart, markerEnd)
  assert.doesNotMatch(markerPath, /UPDATE public\.payment_orders/)
  assert.doesNotMatch(markerPath, /FROM public\.payment_orders[^;]*FOR UPDATE/)
  assert.match(markerPath, /FROM public\.payment_provider_transactions\s+WHERE payment_order_id = v_order_id\s+FOR UPDATE/)
})

test('payapp paid feedback records first and fulfills in a catch-all subblock', () => {
  const body = functionBody(migration, 'apply_payapp_feedback')
  const record = body.indexOf('paid_feedback_recorded_at = COALESCE(paid_feedback_recorded_at, now())')
  const fulfill = body.indexOf('v_fulfill := public.payapp_fulfill_order_internal(')
  assert.ok(record > 0 && fulfill > record)
  assert.match(body.slice(fulfill), /EXCEPTION\s+WHEN OTHERS THEN/)
  assert.match(body, /IF v_ppt\.cancel_feedback_recorded_at IS NOT NULL\s+OR v_ppt\.partial_cancel_feedback_recorded_at IS NOT NULL THEN/)
})

test('payapp cancellation processing retries transient errors and falls back for everything else', () => {
  const body = functionBody(migration, 'process_payapp_cancellation')
  assert.match(body, /IF v_error_state IN \('40P01', '40001', '55P03'\) THEN\s+RAISE;/)
  assert.match(body, /ERRCODE = '40001'/)
  assert.match(body, /'PAYAPP_CANCEL_HANDLING_FAILED'/)
  assert.match(body, /SET status = 'pending_refund'\s+WHERE id = v_source\.id\s+AND status = 'active'/)
})

test('reconciliation candidate conditions are identical and cancel markers bypass backoff', () => {
  const claim = candidateCondition(functionBody(migration, 'claim_payment_reconciliation_batch'))
  const backlog = candidateCondition(functionBody(migration, 'payment_reconciliation_backlog_count'))
  assert.equal(claim, backlog)
  assert.match(
    claim,
    /AND \(po\.next_reconcile_at IS NULL OR po\.next_reconcile_at <= now\(\)\) \) OR \( po\.provider IN \('payapp', 'kakaopay'\)/
  )
  assert.match(claim, /AND NOT \(rr\.provider = 'payapp' AND rr\.status = 'retryable_failed'\)/)
  assert.match(
    functionBody(migration, 'claim_payment_reconciliation_batch'),
    /FOR UPDATE OF po SKIP LOCKED/
  )
})

test('the existing kakaopay health block is unchanged', () => {
  const before = kakaoHealthBlock(
    functionBody(schedulerMigration, 'enforce_payment_reconciliation_health')
  )
  const after = kakaoHealthBlock(functionBody(migration, 'enforce_payment_reconciliation_health'))
  assert.equal(after, before)
  const body = functionBody(migration, 'enforce_payment_reconciliation_health')
  assert.match(body, /'kakaopay_disabled', v_should_disable OR v_kakao_marker_disable/)
  assert.match(body, /'payapp_disabled', v_payapp_disable/)
})

test('kakaopay partial cancellation always closes its marker and only ends by manual completion', () => {
  const quarantine = functionBody(migration, 'quarantine_kakaopay_partial_cancellation')
  assert.match(quarantine, /partial_cancel_processed_at = COALESCE\(partial_cancel_processed_at, now\(\)\)/)
  assert.match(quarantine, /origin = 'partial_cancel'/)
  const finalize = functionBody(migration, 'finalize_point_charge_refund')
  assert.match(
    finalize,
    /IF v_request\.provider = 'kakaopay' AND v_request\.origin = 'partial_cancel' THEN\s+RAISE EXCEPTION 'REFUND_REQUIRES_MANUAL_COMPLETION'/
  )
})

test('rejecting a refund keeps the old call shape and refuses cancelled payments', () => {
  assert.match(migration, /DROP FUNCTION public\.reject_point_charge_refund\(uuid, uuid, text\);/)
  const body = functionBody(migration, 'reject_point_charge_refund')
  assert.match(body, /p_provider_not_cancelled_confirmed boolean DEFAULT false/)
  assert.match(body, /v_request\.origin <> 'user'/)
  assert.match(body, /v_order\.canceled_at IS NOT NULL/)
})

test('every new or replaced payment function is server-only', () => {
  const grantList = migration.slice(migration.indexOf('FOREACH v_signature IN ARRAY ARRAY['))
  for (const name of new Set(createdFunctions)) {
    if (triggerFunctions.has(name)) continue
    const body = functionBody(migration, name)
    assert.match(body, /SECURITY DEFINER/, `${name} is security definer`)
    assert.match(body, /SET search_path TO 'public', 'pg_temp'/, `${name} pins search_path`)
    if (name === 'payapp_fulfill_order_internal') {
      assert.match(
        migration,
        /REVOKE ALL ON FUNCTION public\.payapp_fulfill_order_internal\(uuid, timestamp with time zone\)\s+FROM PUBLIC, anon, authenticated, service_role;/
      )
      continue
    }
    if (name === 'get_my_payment_history' || name === 'get_my_refund_requests') {
      assert.match(
        migration,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(\\) TO authenticated, service_role;`)
      )
      continue
    }
    assert.match(grantList, new RegExp(`'public\\.${name}\\(`), `${name} is in the grant list`)
  }
})

test('production-only credit functions are revoked behind an existence guard', () => {
  assert.match(
    migration,
    /IF to_regprocedure\('public\.consume_credits_once\(uuid,integer,text,uuid,text,text\)'\) IS NOT NULL THEN\s+REVOKE EXECUTE ON FUNCTION public\.consume_credits_once/
  )
  assert.match(
    migration,
    /IF to_regprocedure\('public\.refund_credits_once\(uuid,integer,text,uuid,text,text,text,integer\)'\) IS NOT NULL THEN\s+REVOKE EXECUTE ON FUNCTION public\.refund_credits_once/
  )
  assert.doesNotMatch(migration, /'public\.(consume|refund)_credits_once[^']*'::regprocedure/)
})

test('user history adds the method label and total refunded amount without duplicating rows', () => {
  const body = functionBody(migration, 'get_my_payment_history')
  assert.match(body, /payment_method_label text,\s+refunded_amount integer/)
  assert.match(
    body,
    /SELECT SUM\(rr\.refund_amount\)\s+FROM public\.refund_requests rr\s+WHERE rr\.source_id = ph\.source_id\s+AND rr\.status = 'completed'/
  )
  assert.match(functionBody(migration, 'get_my_refund_requests'), /origin text/)
})

test('the revoke list and the verification list name the same functions', () => {
  const lists = [...migration.matchAll(/FOREACH v_signature IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP/g)]
    .map((match) => [...match[1].matchAll(/'(public\.[^']+)'/g)].map((item) => item[1]))
    .filter((items) => items.length > 0 && items[0].startsWith('public.'))
  assert.equal(lists.length, 2)
  assert.deepEqual(lists[1], lists[0])
})

test('new tables give service_role read-only access despite default privileges', () => {
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.payment_admin_actions FROM PUBLIC, anon, authenticated, service_role;/
  )
  assert.match(migration, /c\.relacl::text = '\{postgres=arwdDxtm\/postgres,service_role=r\/postgres\}'/)
})
