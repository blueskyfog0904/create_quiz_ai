import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

function readSql(dir, suffix) {
  const dirUrl = new URL(`../supabase/${dir}/`, import.meta.url)
  const filename = readdirSync(dirUrl).find((name) => name.endsWith(suffix))

  return filename ? readFileSync(new URL(filename, dirUrl), 'utf8') : ''
}

const migration = readSql('migrations', '_credit_ledger_integrity.sql')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const rollback = readSql('rollback', '_credit_ledger_integrity_down.sql')
const rollbackCode = rollback.replace(/--[^\n]*/g, '')

// 운영 원문 md5(계획 1.4, 2026-11-10 pg_get_functiondef)
const originalMd5 = {
  refund_credits: '6a082ed597597efdbb688225076a3996',
  consume_credits_once: '5bba3e44100b1eb403da9210b87ad53e',
  refund_credits_once: '5a7af4fbce9ef158d411b505cd419e6d',
}

function functionBody(sql, name) {
  const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))
  assert.notEqual(start, -1, `${name} is defined`)
  const rest = sql.slice(start)
  const end = rest.search(/\n\$(?:function)?\$;/)
  assert.notEqual(end, -1, `${name} body ends`)
  return rest.slice(0, end)
}

// pg_get_functiondef 원문 형식(끝의 "$function$\n")으로 되돌려 md5를 낸다.
function definitionMd5(sql, name) {
  return createHash('md5').update(`${functionBody(sql, name)}\n$function$\n`).digest('hex')
}

function indexOfOrFail(text, needle, label = needle) {
  const at = text.indexOf(needle)
  assert.notEqual(at, -1, label)
  return at
}

test('migration 2 runs in one bounded transaction without CASCADE or public grants', () => {
  assert.ok(migration, 'migration file exists')
  assert.match(migrationCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.doesNotMatch(migrationCode, /\bCASCADE\b/i)
  assert.doesNotMatch(migrationCode, /^\s*(BEGIN|COMMIT)\s*;/im)
  assert.doesNotMatch(migrationCode, /^\s*GRANT [^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/m)
  assert.match(migrationCode.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('migration 2 prechecks migration 1, original definitions, ledger violations and *_once references before any change', () => {
  const firstChange = migrationCode.search(/ALTER TABLE|CREATE (OR REPLACE )?FUNCTION|DROP FUNCTION/)
  assert.notEqual(firstChange, -1)

  const keyCheck = indexOfOrFail(migrationCode, "to_regclass('public.payment_reconciliation_alerts_active_key') IS NULL")
  assert.ok(keyCheck < firstChange, 'alert key check runs first')
  assert.match(migrationCode, /RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: payment_reconciliation_alerts_active_key missing/)

  for (const [name, md5] of Object.entries(originalMd5)) {
    const at = indexOfOrFail(migrationCode, `IS DISTINCT FROM '${md5}'`, `${name} md5 precheck`)
    assert.ok(at < firstChange, `${name} md5 precheck runs before changes`)
    assert.match(migrationCode, new RegExp(`CREDIT_LEDGER_PRECHECK: ${name} definition drifted`))
  }

  for (const constraint of [
    'credit_sources_initial_credits_positive',
    'credit_sources_remaining_credits_range',
    'credit_consumption_amount_positive',
    'profiles_credits_nonnegative',
    'payment_history_amount_charge_limit',
  ]) {
    const at = indexOfOrFail(migrationCode, `CREDIT_LEDGER_PRECHECK: ${constraint} violated (% rows)`)
    assert.ok(at < firstChange, `${constraint} precheck runs before changes`)
  }

  const refs = indexOfOrFail(migrationCode, "AND p.proname NOT IN ('consume_credits_once', 'refund_credits_once')")
  assert.ok(refs < firstChange)
  assert.match(migrationCode, /pg_get_functiondef\(p\.oid\) ILIKE '%_credits_once\(%'/)
  assert.match(migrationCode, /CREDIT_LEDGER_PRECHECK: _credits_once referenced by % functions/)
})

test('constraints are added in lock order profiles -> credit_sources -> credit_consumption -> payment_history', () => {
  const profiles = indexOfOrFail(migrationCode, 'ALTER TABLE public.profiles\n  ADD CONSTRAINT profiles_credits_nonnegative CHECK (credits >= 0);')
  const sources = indexOfOrFail(
    migrationCode,
    'ALTER TABLE public.credit_sources\n'
      + '  ADD CONSTRAINT credit_sources_initial_credits_positive CHECK (initial_credits > 0),\n'
      + '  ADD CONSTRAINT credit_sources_remaining_credits_range CHECK (remaining_credits >= 0 AND remaining_credits <= initial_credits);'
  )
  const consumption = indexOfOrFail(migrationCode, 'ALTER TABLE public.credit_consumption\n  ADD CONSTRAINT credit_consumption_amount_positive CHECK (amount > 0);')
  const history = indexOfOrFail(migrationCode, 'ALTER TABLE public.payment_history VALIDATE CONSTRAINT payment_history_amount_charge_limit;')
  assert.ok(profiles < sources && sources < consumption && consumption < history)
  assert.equal(migrationCode.match(/VALIDATE CONSTRAINT/g).length, 1)
  assert.equal(migrationCode.match(/ADD CONSTRAINT/g).length, 4)
  assert.doesNotMatch(migrationCode, /NOT VALID/)
})

test('the three functions keep SECURITY DEFINER and a fixed search_path', () => {
  for (const name of ['refund_credits', 'approve_market_refund', 'grant_admin_credits']) {
    const body = functionBody(migrationCode, name)
    assert.match(body, /\n SECURITY DEFINER\n/, name)
    assert.match(body, /\n SET search_path TO 'public', 'pg_temp'\n/, name)
  }
})

test('refund_credits skips unrestorable sources, records only real increases and alerts every skipped credit', () => {
  const body = functionBody(migrationCode, 'refund_credits')
  assert.match(
    body,
    /^CREATE OR REPLACE FUNCTION public\.refund_credits\(p_user_id uuid, p_amount integer, p_resource_type text, p_resource_id uuid, p_description text, p_consumptions jsonb, p_target_balance integer DEFAULT NULL::integer\)\n RETURNS jsonb\n/
  )

  // 2.6 정규화의 전제: 항목에서 source_id 키만 읽는 줄은 운영 원문 그대로다.
  assert.ok(body.includes("    v_source_id := NULLIF(v_item->>'source_id', '')::uuid;"))
  assert.doesNotMatch(body, /sourceId/)

  assert.match(
    body,
    /SELECT initial_credits, remaining_credits, status, expires_at\n\s+INTO v_source_initial, v_before, v_source_status, v_source_expires_at\n\s+FROM public\.credit_sources\n\s+WHERE id = v_source_id\n\s+AND user_id = p_user_id\n\s+FOR UPDATE;/
  )

  const guard = indexOfOrFail(body, "IF v_source_status NOT IN ('active', 'pending_refund')")
  const update = indexOfOrFail(body, 'UPDATE public.credit_sources')
  assert.ok(guard < update, 'restorability is decided before the source update')
  const guardBlock = body.slice(guard, body.indexOf('END IF;', guard))
  assert.match(guardBlock, /OR \(v_source_expires_at IS NOT NULL AND v_source_expires_at <= v_now\)/)
  assert.match(guardBlock, /v_skipped_unrestorable := v_skipped_unrestorable \+ LEAST\(v_refund_amount, v_remaining_refund\);/)
  assert.match(guardBlock, /\bCONTINUE;/)
  assert.doesNotMatch(guardBlock, /RAISE/)
  assert.doesNotMatch(body, /CREDIT_REFUND_SOURCE_NOT_RESTORABLE/)

  assert.match(body, /WHERE id = v_source_id\n\s+RETURNING remaining_credits INTO v_after;/)
  assert.match(body, /v_total_refunded := v_total_refunded \+ \(v_after - v_before\);/)
  assert.match(body, /v_skipped_capped := v_skipped_capped \+ \(v_refund_amount - \(v_after - v_before\)\);/)
  assert.match(body, /v_skipped_unmatched := GREATEST\(v_remaining_refund, 0\);/)
  assert.match(body, /v_skipped := v_skipped_unrestorable \+ v_skipped_capped \+ v_skipped_unmatched;/)

  // 거래 행은 실제 복구가 있을 때만 만든다.
  const txIf = indexOfOrFail(body, 'IF v_total_refunded > 0 THEN\n    INSERT INTO public.credit_transactions (')
  assert.equal(body.match(/INSERT INTO public\.credit_transactions/g).length, 1)
  assert.ok(txIf > update)

  // 건너뛴 양은 호출마다 1행의 경보로 남는다.
  const alert = body.slice(indexOfOrFail(body, 'IF v_skipped > 0 THEN'))
  assert.match(alert, /PERFORM public\.record_payment_alert\(\n\s+'CREDIT_REFUND_SOURCE_SKIPPED', 'warning',/)
  for (const key of ['skipped_unrestorable', 'skipped_capped', 'skipped_unmatched', 'requested', 'refunded', 'skipped']) {
    assert.match(alert, new RegExp(`'${key}', `), key)
  }
  assert.match(alert, /'dedupe_key', 'credit_refund_skip:' \|\| gen_random_uuid\(\)::text/)
  assert.match(body, /RETURN jsonb_build_object\(\n\s+'new_balance', v_new_balance,\n\s+'refunded', v_total_refunded,\n\s+'skipped', v_skipped\n\s+\);/)

  // p_target_balance는 시그니처 호환용이다(questions/generate route가 balanceBeforeGeneration을 넘긴다). 잔액·balance_after에 쓰지 않는다.
  const afterHeader = body.slice(body.indexOf('AS $function$'))
  assert.doesNotMatch(afterHeader, /p_target_balance/)
  assert.match(body, /UPDATE public\.profiles\n\s+SET credits = v_new_balance\n\s+WHERE id = p_user_id;/)
})

test('approve_market_refund locks profiles first and approves, restores and revokes in one transaction', () => {
  const body = functionBody(migrationCode, 'approve_market_refund')
  assert.match(
    body,
    /^CREATE FUNCTION public\.approve_market_refund\(\n\s+p_request_id uuid,\n\s+p_admin_id uuid,\n\s+p_admin_note text,\n\s+p_confirmed_refund_credits integer DEFAULT NULL\n\)\n RETURNS jsonb\n/
  )
  assert.doesNotMatch(body, /p_consumptions/)

  const profileLock = indexOfOrFail(body, 'FROM public.profiles\n   WHERE id = v_user_id\n   FOR UPDATE;')
  const requestLock = indexOfOrFail(body, 'FROM public.market_refund_requests\n   WHERE id = p_request_id\n   FOR UPDATE;')
  assert.ok(profileLock < requestLock, 'profiles is locked before the request row')
  const notPending = indexOfOrFail(body, "RAISE EXCEPTION 'MARKET_REFUND_NOT_PENDING'")
  assert.ok(requestLock < notPending)
  assert.match(body, /IF v_request\.status <> 'pending' THEN\n\s+RAISE EXCEPTION 'MARKET_REFUND_NOT_PENDING';/)

  // 대상 잠금과 재검사, 소비 내역은 잠근 행에서 읽는다.
  const orderLock = indexOfOrFail(
    body,
    "SELECT credit_consumptions INTO v_consumptions\n      FROM public.market_purchase_orders\n     WHERE id = v_request.order_id\n       AND user_id = v_request.user_id\n       AND status = 'completed'\n     FOR UPDATE;"
  )
  indexOfOrFail(
    body,
    "SELECT credit_consumptions INTO v_consumptions\n      FROM public.market_purchases\n     WHERE id = v_request.legacy_purchase_id\n       AND user_id = v_request.user_id\n       AND status = 'completed'\n     FOR UPDATE;"
  )
  assert.ok(notPending < orderLock)
  const downloads = indexOfOrFail(body, 'FROM public.market_download_events')
  assert.ok(orderLock < downloads)
  assert.match(body, /order_id = v_request\.order_id\)\n\s+OR \(v_request\.target_kind = 'legacy_purchase' AND purchase_id = v_request\.legacy_purchase_id\)/)
  assert.match(body, /RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED'/)

  // 운영 키 source_id·sourceId를 모두 읽는다.
  assert.match(body, /COALESCE\(v_item->>'source_id', v_item->>'sourceId'\)/)
  const sourceLock = indexOfOrFail(body, 'FROM public.credit_sources\n     WHERE id = v_source_id\n       AND user_id = v_request.user_id\n     FOR UPDATE;')
  assert.ok(downloads < sourceLock)
  assert.match(body, /RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND'/)

  // 정규화한 새 원소만 넘긴다. 원래 요소(v_item)를 그대로 넣지 않는다.
  assert.match(body, /v_alloc := GREATEST\(LEAST\(v_take, v_source\.initial_credits - v_source\.remaining_credits - v_already\), 0\);/)
  assert.match(
    body,
    /IF v_alloc > 0 THEN\n\s+v_restore_items := v_restore_items \|\| jsonb_build_array\(\n\s+jsonb_build_object\('source_id', v_source_id, 'amount', v_alloc\)\n\s+\);/
  )
  assert.doesNotMatch(body, /v_restore_items \|\|[^;]*v_item/)
  assert.doesNotMatch(body, /jsonb_build_array\(v_item\)/)

  // 판정: 일반 승인은 전액 복구 가능할 때만, 확인 승인은 숫자가 같을 때만.
  const shortfall = indexOfOrFail(body, "RAISE EXCEPTION 'MARKET_REFUND_SHORTFALL'")
  assert.match(body, /p_confirmed_refund_credits IS NULL AND v_restorable <> v_request\.requested_refund_credits/)
  assert.match(body, /p_confirmed_refund_credits IS NOT NULL AND p_confirmed_refund_credits <> v_restorable/)
  assert.match(body, /USING DETAIL = jsonb_build_object\(\n\s+'requested', v_request\.requested_refund_credits,\n\s+'restorable', v_restorable\n\s+\)::text;/)

  const refundCall = indexOfOrFail(body, 'v_refund := public.refund_credits(')
  assert.ok(shortfall < refundCall)
  assert.match(body, /IF v_restorable > 0 THEN\n\s+v_refund := public\.refund_credits\(/)
  assert.match(body, /'market_refund',\n\s+v_request\.id,\n\s+'문제마켓 구매 환불',\n\s+v_restore_items\n\s+\);/)
  assert.match(
    body,
    /IF \(v_refund->>'refunded'\)::integer <> v_restorable\n\s+OR \(v_refund->>'skipped'\)::integer <> 0 THEN\n\s+RAISE EXCEPTION 'MARKET_REFUND_AMOUNT_MISMATCH';/
  )

  // 상태 변경 뒤 승인.
  const orders = indexOfOrFail(body, "UPDATE public.market_purchase_orders\n       SET status = 'refunded'")
  const lines = indexOfOrFail(body, "UPDATE public.market_purchase_lines\n       SET status = 'refunded'\n     WHERE order_id = v_request.order_id;")
  const entitlements = indexOfOrFail(body, "UPDATE public.market_entitlements\n       SET status = 'refunded'\n     WHERE source_order_id = v_request.order_id;")
  indexOfOrFail(body, "UPDATE public.market_purchases\n       SET status = 'refunded',\n           refunded_at = v_now")
  const approved = indexOfOrFail(body, "UPDATE public.market_refund_requests\n     SET status = 'approved',\n         approved_refund_credits = v_restorable,")
  assert.ok(refundCall < orders && orders < lines && lines < entitlements && entitlements < approved)
  assert.match(body, /\[부족분 %s크레딧: 환불 완료·만료된 원천이라 복구하지 않음\. 보상 여부는 관리자 판단\]/)

  const alert = body.slice(indexOfOrFail(body, "'MARKET_REFUND_SHORTFALL', 'warning',"))
  assert.ok(body.indexOf("'MARKET_REFUND_SHORTFALL', 'warning',") > approved)
  assert.match(alert, /'dedupe_key', 'market_refund:' \|\| v_request\.id::text/)
  for (const key of ['request_id', 'user_id', 'requested', 'refunded', 'shortfall', 'actor_id']) {
    assert.match(alert, new RegExp(`'${key}', `), key)
  }
  assert.match(body, /RETURN to_jsonb\(v_request\) \|\| jsonb_build_object\(\n\s+'new_balance', v_new_balance,\n\s+'shortfall', v_shortfall\n\s+\);/)

  assert.ok(migrationCode.includes('REVOKE ALL ON FUNCTION public.approve_market_refund(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;'))
  assert.ok(migrationCode.includes('GRANT EXECUTE ON FUNCTION public.approve_market_refund(uuid, uuid, text, integer) TO service_role;'))
})

test('grant_admin_credits is atomic and idempotent per operation key', () => {
  const body = functionBody(migrationCode, 'grant_admin_credits')
  assert.match(
    body,
    /^CREATE FUNCTION public\.grant_admin_credits\(\n\s+p_user_id uuid,\n\s+p_amount integer,\n\s+p_source_category text,\n\s+p_payment_method text,\n\s+p_operation_key text\n\)\n RETURNS jsonb\n/
  )

  const input = indexOfOrFail(body, "RAISE EXCEPTION 'ADMIN_GRANT_INPUT_INVALID'")
  assert.match(body, /p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 10000/)
  assert.match(body, /p_source_category NOT IN \('admin_grant', 'bonus', 'system_refund'\)/)
  assert.match(body, /length\(p_operation_key\) NOT BETWEEN 1 AND 120/)

  const profileLock = indexOfOrFail(body, 'FROM public.profiles\n   WHERE id = p_user_id\n   FOR UPDATE;')
  const lookup = indexOfOrFail(body, 'FROM public.credit_transactions\n   WHERE operation_key = p_operation_key')
  assert.ok(input < profileLock && profileLock < lookup, 'operation key lookup happens under the profile lock')

  const conflict = indexOfOrFail(body, "RAISE EXCEPTION 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT'")
  const comparison = body.slice(lookup, conflict)
  assert.match(comparison, /v_existing\.user_id IS DISTINCT FROM p_user_id/)
  assert.match(comparison, /v_existing\.amount IS DISTINCT FROM p_amount/)
  assert.match(comparison, /v_existing_category IS DISTINCT FROM p_source_category/)
  assert.match(comparison, /v_existing_payment_method IS DISTINCT FROM p_payment_method/)
  assert.match(comparison, /FROM public\.payment_history\n\s+WHERE source_id = v_existing\.source_id/)
  assert.match(body, /'already_granted', true,/)

  const source = indexOfOrFail(body, 'INSERT INTO public.credit_sources (')
  const cache = indexOfOrFail(body, 'UPDATE public.profiles\n     SET credits = v_new_balance')
  const history = indexOfOrFail(body, 'INSERT INTO public.payment_history (')
  const tx = indexOfOrFail(body, 'INSERT INTO public.credit_transactions (')
  assert.ok(conflict < source && source < cache && cache < history && history < tx)
  assert.match(body, /'purchase',\n\s+p_amount,\n\s+v_new_balance,\n\s+format\('크레딧 %s개 구매', to_char\(p_amount, 'FM999,999,999'\)\),\n\s+v_source_id,\n\s+p_operation_key/)
  assert.match(body, /'already_granted', false,/)

  assert.ok(migrationCode.includes('REVOKE ALL ON FUNCTION public.grant_admin_credits(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;'))
  assert.ok(migrationCode.includes('GRANT EXECUTE ON FUNCTION public.grant_admin_credits(uuid, integer, text, text, text) TO service_role;'))
})

test('legacy *_credits_once functions are dropped with exact signatures after the replacements', () => {
  const consume = indexOfOrFail(migrationCode, 'DROP FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text);')
  const refund = indexOfOrFail(migrationCode, 'DROP FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer);')
  assert.equal(migrationCode.match(/DROP FUNCTION/g).length, 2)
  const lastCreate = migrationCode.lastIndexOf('CREATE FUNCTION public.grant_admin_credits(')
  assert.ok(lastCreate < consume && consume < refund)
})

test('migration 2 postchecks security definer, search_path and service_role-only ACL', () => {
  const post = migrationCode.slice(migrationCode.lastIndexOf('DO $$'))
  for (const signature of [
    "'public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)'::regprocedure",
    "'public.approve_market_refund(uuid, uuid, text, integer)'::regprocedure",
    "'public.grant_admin_credits(uuid, integer, text, text, text)'::regprocedure",
  ]) {
    assert.ok(post.includes(signature), signature)
  }
  assert.match(post, /NOT \(SELECT prosecdef FROM pg_proc WHERE oid = v_fn\)/)
  assert.match(post, /@> ARRAY\['search_path=public, pg_temp'\]/)
  assert.match(post, /IS DISTINCT FROM '\{postgres=X\/postgres,service_role=X\/postgres\}'/)
})

test('rollback restores the production originals in reverse order and keeps their ACL', () => {
  assert.ok(rollback, 'rollback file exists')
  assert.match(rollbackCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.doesNotMatch(rollbackCode, /\bCASCADE\b/i)
  assert.doesNotMatch(rollbackCode, /^\s*(BEGIN|COMMIT)\s*;/im)

  // 파일 머리 주석의 md5와 원문 본문이 같다.
  for (const [name, md5] of Object.entries(originalMd5)) {
    assert.match(rollback, new RegExp(`--\\s+${name}\\s+${md5}`), `${name} md5 header`)
    assert.equal(definitionMd5(rollbackCode, name), md5, `${name} restored verbatim`)
  }

  for (const signature of [
    'consume_credits_once(uuid, integer, text, uuid, text, text)',
    'refund_credits_once(uuid, integer, text, uuid, text, text, text, integer)',
  ]) {
    assert.ok(rollbackCode.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`), signature)
    assert.ok(rollbackCode.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`), signature)
  }
  assert.doesNotMatch(rollbackCode, /^\s*GRANT [^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/m)

  // 마이그레이션의 역순: *_once 복원 → 새 함수 DROP → refund_credits 원문 → 제약 DROP
  const onceRestore = indexOfOrFail(rollbackCode, 'CREATE OR REPLACE FUNCTION public.consume_credits_once(')
  const dropGrant = indexOfOrFail(rollbackCode, 'DROP FUNCTION public.grant_admin_credits(uuid, integer, text, text, text);')
  const dropApprove = indexOfOrFail(rollbackCode, 'DROP FUNCTION public.approve_market_refund(uuid, uuid, text, integer);')
  const refundRestore = indexOfOrFail(rollbackCode, 'CREATE OR REPLACE FUNCTION public.refund_credits(')
  const dropProfiles = indexOfOrFail(rollbackCode, 'ALTER TABLE public.profiles\n  DROP CONSTRAINT profiles_credits_nonnegative;')
  const dropSources = indexOfOrFail(
    rollbackCode,
    'ALTER TABLE public.credit_sources\n  DROP CONSTRAINT credit_sources_remaining_credits_range,\n  DROP CONSTRAINT credit_sources_initial_credits_positive;'
  )
  const dropConsumption = indexOfOrFail(rollbackCode, 'ALTER TABLE public.credit_consumption\n  DROP CONSTRAINT credit_consumption_amount_positive;')
  assert.ok(onceRestore < dropGrant && dropGrant < dropApprove && dropApprove < refundRestore && refundRestore < dropProfiles)
  // 잠금 순서는 마이그레이션과 같다.
  assert.ok(dropProfiles < dropSources && dropSources < dropConsumption)
  assert.doesNotMatch(rollbackCode, /DROP CONSTRAINT payment_history_amount_charge_limit/)
  assert.doesNotMatch(rollbackCode, /CREATE (OR REPLACE )?FUNCTION public\.(approve_market_refund|grant_admin_credits)\(/)
  assert.match(rollbackCode.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})
