import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

function readSql(dir, suffix) {
  const dirUrl = new URL(`../supabase/${dir}/`, import.meta.url)
  const filename = readdirSync(dirUrl).find((name) => name.endsWith(suffix))

  return filename ? readFileSync(new URL(filename, dirUrl), 'utf8') : ''
}

const migration = readSql('migrations', '_payapp_migration_b2.sql')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const rollback = readSql('rollback', '_payapp_migration_b2_down.sql')
const migrationA = readSql('migrations', '_payapp_migration_a.sql')

const tossFunctions = [
  'finalize_toss_payment',
  'get_toss_refund_eligibility',
  'request_toss_refund',
  'claim_toss_refund',
  'finalize_toss_refund',
  'fail_toss_refund',
  'reject_toss_refund',
]

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

test('migration B2 runs in one bounded transaction without CASCADE', () => {
  assert.ok(migration, 'B2 migration file exists')
  assert.match(migrationCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.doesNotMatch(migrationCode, /\bCASCADE\b/i)
  assert.doesNotMatch(migrationCode, /^\s*(BEGIN|COMMIT)\s*;/im)
  assert.match(migrationCode.trimEnd(), /NOTIFY pgrst, 'reload schema';$/)
})

test('migration B2 stops first when toss orders or refunds are still open', () => {
  const guardAt = migrationCode.indexOf("RAISE EXCEPTION 'B2_PRECHECK: open toss payment orders'")
  assert.notEqual(guardAt, -1)
  assert.ok(guardAt < migrationCode.indexOf('CREATE OR REPLACE FUNCTION'), 'precheck runs before any change')
  assert.match(migrationCode, /provider = 'toss'\n\s+AND status NOT IN \('completed', 'failed', 'expired', 'refunded'\)/)
  assert.match(migrationCode, /provider = 'toss'\n\s+AND status NOT IN \('completed', 'rejected'\)/)
})

test('migration B2 drops the seven toss RPCs and both toss runtime columns', () => {
  const signatures = {
    finalize_toss_payment: 'uuid, text, text, text, text, timestamp with time zone',
    get_toss_refund_eligibility: 'uuid, uuid',
    request_toss_refund: 'uuid, uuid, text',
    claim_toss_refund: 'uuid, uuid, text',
    finalize_toss_refund: 'uuid, text, timestamp with time zone',
    fail_toss_refund: 'uuid, text, text, boolean',
    reject_toss_refund: 'uuid, uuid, text',
  }
  for (const name of tossFunctions) {
    assert.ok(migrationCode.includes(`DROP FUNCTION public.${name}(${signatures[name]});`), name)
    assert.doesNotMatch(migrationCode, new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`), name)
  }

  assert.match(migrationCode, /DROP COLUMN toss_accepts_new_orders/)
  assert.match(migrationCode, /DROP COLUMN toss_merchant_id/)
})

test('migration B2 keeps toss history columns and checks', () => {
  assert.doesNotMatch(migrationCode, /DROP CONSTRAINT/i)
  assert.doesNotMatch(migrationCode, /DROP COLUMN (mid|payment_key)\b/)
  assert.match(migrationCode, /payment_orders_provider_snapshot_check/)
})

test('prepare_payment_order rejects toss input and keeps its signature', () => {
  const body = functionBody(migrationCode, 'prepare_payment_order')
  assert.match(body, /IF p_provider NOT IN \('kakaopay', 'payapp'\)/)
  assert.match(body, /p_payment_method_code text DEFAULT NULL\n\)/)
  assert.match(body, /OR \(p_provider = 'kakaopay' AND p_payment_method_code IS NOT NULL/)
  assert.match(migrationCode, /CREATE OR REPLACE FUNCTION public\.prepare_payment_order\(/)
})

test('toss sources are no longer refundable', () => {
  const eligibility = functionBody(migrationCode, 'get_point_charge_refund_eligibility')
  const tossBlock = eligibility.indexOf("IF v_order.provider = 'toss' THEN")
  const allowed = eligibility.indexOf("'allowed', true")
  assert.notEqual(tossBlock, -1)
  assert.ok(tossBlock < allowed, 'toss block runs before the allowed result')
  assert.match(eligibility.slice(tossBlock, allowed), /'REFUND_COMPLETED_PAYMENT_REQUIRED'/)

  const claim = functionBody(migrationCode, 'claim_point_charge_refund')
  assert.match(claim, /IF v_order\.provider = 'toss' THEN\n\s+RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';/)
})

test('B2 verify block checks redefined bodies and the toss order rejection', () => {
  const verify = migrationCode.slice(migrationCode.lastIndexOf('DO $$'))
  for (const name of ['prepare_payment_order', 'get_point_charge_refund_eligibility', 'claim_point_charge_refund']) {
    assert.match(verify, new RegExp(`proname = '${name}'\\) IS DISTINCT FROM '[0-9a-f]{32}'`), name)
  }
  assert.match(verify, /PERFORM public\.prepare_payment_order\(\n\s+gen_random_uuid\(\), gen_random_uuid\(\), 'toss'/)
  assert.match(verify, /v_message IS DISTINCT FROM 'PAYMENT_ORDER_INPUT_INVALID'/)
})

test('redefined functions keep service-role-only execute grants', () => {
  for (const name of ['prepare_payment_order', 'get_point_charge_refund_eligibility', 'claim_point_charge_refund']) {
    assert.match(migrationCode, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`), name)
    assert.match(migrationCode, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`), name)
  }
})

test('B2 rollback restores toss RPCs, columns and the pre-B2 definitions', () => {
  assert.ok(rollback, 'B2 rollback file exists')
  for (const name of tossFunctions) {
    assert.match(rollback, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`), name)
  }
  assert.match(rollback, /ADD COLUMN toss_accepts_new_orders boolean NOT NULL DEFAULT false/)
  assert.match(rollback, /ADD COLUMN toss_merchant_id text/)
  assert.match(rollback, /toss_merchant_id = 'tgen_docs'/)

  for (const name of ['get_point_charge_refund_eligibility', 'claim_point_charge_refund']) {
    assert.equal(functionBody(rollback, name), functionBody(migrationA, name), name)
  }
  assert.equal(
    functionBody(rollback, 'prepare_payment_order').replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION'),
    functionBody(migrationA, 'prepare_payment_order')
  )
})
