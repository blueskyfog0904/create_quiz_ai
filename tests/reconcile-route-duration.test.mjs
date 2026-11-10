import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

const route = readFileSync(
  new URL('../src/app/api/internal/payments/reconcile/route.ts', import.meta.url),
  'utf8'
)

const migrationsDir = new URL('../supabase/migrations/', import.meta.url)
const migrationName = readdirSync(migrationsDir).find((name) => name.endsWith('_payment_integrity_fixes.sql'))
const migration = migrationName ? readFileSync(new URL(migrationName, migrationsDir), 'utf8') : ''

// start_payment_reconciliation_run이 잡는 리스 길이(초). 리스가 만료된 run은 abandoned로 세어진다.
function leaseSeconds() {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.start_payment_reconciliation_run(')
  assert.notEqual(start, -1, 'start_payment_reconciliation_run is redefined')
  const body = migration.slice(start, migration.indexOf('\n$function$;', start))
  const match = body.match(/lease_expires_at = v_now \+ interval '(\d+) minutes'/)
  assert.ok(match, 'lease interval is found')
  return Number(match[1]) * 60
}

test('reconcile route allows a function duration longer than the reconciliation lease', () => {
  const match = route.match(/^export const maxDuration = (\d+)$/m)
  assert.ok(match, 'reconcile route exports maxDuration')
  assert.equal(Number(match[1]), 300)
  assert.equal(leaseSeconds(), 240)
  assert.ok(Number(match[1]) > leaseSeconds(), 'maxDuration is longer than the lease')
})
