import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migration = read(
  '../supabase/migrations/20260805100000_create_payment_orders_and_atomic_fulfillment.sql'
)
const orderRoute = read('../src/app/api/payments/orders/route.ts')
const checkoutClient = read('../src/app/checkout/checkout-client.tsx')
const pricingActions = read('../src/app/(admin)/admin/pricing/actions.ts')
const pricingDialog = read(
  '../src/app/(admin)/admin/pricing/components/pricing-plan-dialog.tsx'
)

test('payment orders own immutable plan, amount and credit snapshots', () => {
  assert.match(migration, /create table\s+if not exists\s+public\.payment_orders/i)
  assert.match(migration, /order_id\s+text\s+not null\s+unique/i)
  assert.match(migration, /expected_amount\s+integer\s+not null/i)
  assert.match(migration, /expected_credits\s+integer\s+not null/i)
  assert.match(migration, /expected_amount\s+between\s+1\s+and\s+100000/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /users can view own payment orders/i)
  assert.match(migration, /revoke\s+(?:all|insert,\s*update,\s*delete)[\s\S]*payment_orders[\s\S]*authenticated/i)
})

test('database enforces the 100,000 won ceiling and payment uniqueness', () => {
  assert.match(migration, /pricing_plans_price_charge_limit/i)
  assert.match(migration, /price\s+between\s+1\s+and\s+100000/i)
  assert.match(migration, /payment_history_amount_charge_limit/i)
  assert.match(migration, /amount\s+between\s+0\s+and\s+100000/i)
  assert.match(migration, /unique[\s\S]*order_id/i)
  assert.match(migration, /unique[\s\S]*payment_key/i)
})

test('order preparation is authenticated, server priced and fail-closed', () => {
  assert.match(orderRoute, /auth\.getUser\(\)/)
  assert.match(orderRoute, /z\.object/)
  assert.match(orderRoute, /\.from\('pricing_plans'\)/)
  assert.match(orderRoute, /plan\.price\s*>\s*MAX_POINT_CHARGE_AMOUNT/)
  assert.match(orderRoute, /assertTossPaymentsReady/)
  assert.match(orderRoute, /crypto\.randomUUID\(\)/)
  assert.doesNotMatch(orderRoute, /amount:\s*body\./)
})

test('checkout uses only the prepared server order', () => {
  assert.match(checkoutClient, /fetch\('\/api\/payments\/orders'/)
  assert.match(checkoutClient, /order\.orderId/)
  assert.match(checkoutClient, /order\.amount/)
  assert.doesNotMatch(checkoutClient, /generateOrderId/)
  assert.doesNotMatch(checkoutClient, /Math\.random/)
  assert.doesNotMatch(checkoutClient, /variantKey:\s*'DEFAULT'/)
  assert.doesNotMatch(checkoutClient, /successUrl:[^\n]*planId/)
})

test('admin product input and server action enforce the same limit', () => {
  assert.match(pricingActions, /MAX_POINT_CHARGE_AMOUNT/)
  assert.match(pricingActions, /price[\s\S]{0,160}100,000원/)
  assert.match(pricingDialog, /max=\{MAX_POINT_CHARGE_AMOUNT\}/)
  assert.match(pricingDialog, /1회 충전 한도/)
})
