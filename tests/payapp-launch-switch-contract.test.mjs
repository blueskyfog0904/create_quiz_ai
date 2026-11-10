import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

function readSql(dir, suffix) {
  const dirUrl = new URL(`../supabase/${dir}/`, import.meta.url)
  const filename = readdirSync(dirUrl).find((name) => name.endsWith(suffix))

  return filename ? readFileSync(new URL(filename, dirUrl), 'utf8') : ''
}

const migration = readSql('migrations', '_payapp_launch_switch.sql')
const migrationCode = migration.replace(/--[^\n]*/g, '')
const rollback = readSql('rollback', '_payapp_launch_switch_down.sql')
const rollbackCode = rollback.replace(/--[^\n]*/g, '')

test('launch switch rechecks the launch preconditions before opening payapp', () => {
  assert.ok(migration, 'launch switch migration exists')
  assert.match(migrationCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  const update = migrationCode.indexOf('UPDATE public.payment_runtime_config')
  for (const guard of [
    "RAISE EXCEPTION 'PAYAPP_LAUNCH_PRECHECK: unprocessed payapp cancel feedback'",
    "RAISE EXCEPTION 'PAYAPP_LAUNCH_PRECHECK: unresolved payment alerts'",
  ]) {
    const at = migrationCode.indexOf(guard)
    assert.notEqual(at, -1, guard)
    assert.ok(at < update, `${guard} runs before the update`)
  }
  assert.doesNotMatch(migrationCode, /\bCASCADE\b|^\s*(BEGIN|COMMIT)\s*;/im)
})

test('launch switch precheck still stops on any unresolved alert without an UNAUTHORIZED exception', () => {
  assert.match(
    migrationCode,
    /IF EXISTS \(SELECT 1 FROM public\.payment_reconciliation_alerts WHERE resolved_at IS NULL\) THEN\n\s+RAISE EXCEPTION 'PAYAPP_LAUNCH_PRECHECK: unresolved payment alerts';/
  )
  assert.doesNotMatch(migrationCode, /UNAUTHORIZED/)
})

test('launch switch audit strings and rollback path carry the new version', () => {
  assert.match(migration, /^-- 되돌리기\(스위치 off\): supabase\/rollback\/20261110120000_payapp_launch_switch_down\.sql$/m)
  assert.match(migrationCode, /changed_by = 'migration_20261110120000_payapp_launch_switch',/)
  assert.match(rollback, /^-- 20261110120000_payapp_launch_switch 되돌리기/)
  assert.match(rollbackCode, /changed_by = 'rollback_20261110120000_payapp_launch_switch',/)
  assert.doesNotMatch(migration + rollback, /20261021110000/)
})

test('launch switch sorts after both payment integrity migrations', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort()
  const launch = names.findIndex((name) => name.endsWith('_payapp_launch_switch.sql'))
  const fixes = names.findIndex((name) => name.endsWith('_payment_integrity_fixes.sql'))
  const ledger = names.findIndex((name) => name.endsWith('_credit_ledger_integrity.sql'))
  assert.notEqual(fixes, -1, 'payment integrity migration exists')
  assert.notEqual(ledger, -1, 'credit ledger migration exists')
  assert.ok(fixes < ledger && ledger < launch, 'launch switch is applied last')
  assert.equal(names[launch], '20261110120000_payapp_launch_switch.sql')
})

test('launch switch only opens payapp from the recorded pre-launch state', () => {
  assert.match(migrationCode, /c_merchant_id constant text := '[^']+';/)
  assert.match(
    migrationCode,
    /SET payapp_merchant_id = c_merchant_id,\n\s+payapp_accepts_new_orders = true,\n\s+changed_at = now\(\),\n\s+changed_by = '[^']+',\n\s+change_ticket = 'PAYAPP_LAUNCH'/
  )
  assert.match(
    migrationCode,
    /WHERE id = true\n\s+AND master_accepts_new_orders = true\n\s+AND payapp_accepts_new_orders = false\n\s+AND payapp_merchant_id IS NULL;/
  )
  assert.match(migrationCode, /IF v_count <> 1 THEN/)
  assert.doesNotMatch(migrationCode, /kakaopay_|accepted_provider_environment|master_accepts_new_orders =(?! true)/)
})

test('launch switch rollback only closes payapp new orders', () => {
  assert.ok(rollback, 'launch switch rollback exists')
  assert.match(rollbackCode, /SET payapp_accepts_new_orders = false,/)
  assert.match(rollbackCode, /change_ticket = 'PAYAPP_LAUNCH_ROLLBACK'/)
  assert.match(rollbackCode.trimStart(), /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/)
  assert.match(rollbackCode, /WHERE id = true\n\s+AND payapp_accepts_new_orders = true;/)
  assert.match(rollbackCode, /IF v_count <> 1 THEN\n\s+RAISE EXCEPTION 'ROLLBACK: payapp switch is already off';/)
  assert.doesNotMatch(rollbackCode, /payapp_merchant_id|kakaopay_|master_accepts_new_orders/)
})
