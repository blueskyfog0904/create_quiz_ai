import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const checkoutPage = readFileSync('src/app/checkout/page.tsx', 'utf8')
const checkoutClient = readFileSync('src/app/checkout/checkout-client.tsx', 'utf8')
const successPage = readFileSync('src/app/checkout/success/page.tsx', 'utf8')
const failPage = readFileSync('src/app/checkout/fail/page.tsx', 'utf8')

test('checkout server passes only runtime-enabled providers to the client', () => {
  assert.match(checkoutPage, /payment_runtime_config/)
  assert.match(checkoutPage, /availableProviders/)
  assert.match(checkoutPage, /assertTossPaymentsReady/)
  assert.match(checkoutPage, /assertKakaoPayReady/)
})

test('checkout owns one provider-neutral attempt and creates orders only from the CTA', () => {
  assert.match(checkoutClient, /function getCheckoutAttemptId/)
  assert.match(checkoutClient, /point-checkout-attempt:\$\{userId\}:\$\{planId\}`/)
  assert.doesNotMatch(checkoutClient, /point-checkout-attempt:[^\n]*:toss/)
  assert.match(checkoutClient, /const beginPayment = async/)
  assert.match(checkoutClient, /inFlightRef\.current = true/)
  assert.doesNotMatch(checkoutClient, /preparationStartedRef/)
  assert.match(checkoutClient, /\/api\/payments\/orders/)
  assert.match(checkoutClient, /\/api\/payments\/kakaopay\/orders/)
})

test('checkout renders accessible Studio payment-method tabs without mounting inactive Toss UI', () => {
  assert.match(checkoutClient, /StudioContainer/)
  assert.match(checkoutClient, /StudioPageHeader/)
  assert.match(checkoutClient, /TabsList/)
  assert.match(checkoutClient, /일반결제/)
  assert.match(checkoutClient, /카카오페이/)
  assert.match(checkoutClient, /min-h-11/)
  assert.match(checkoutClient, /aria-live="polite"/)
  assert.match(checkoutClient, /motion-reduce:animate-none/)
  assert.match(checkoutClient, /selectedProvider === 'toss'/)
  assert.doesNotMatch(checkoutClient, /forceMount/)
  assert.doesNotMatch(checkoutClient, /max-w-6xl|lg:w-\[380px\]|bg-gray-50/)
})

test('Toss result pages use the same Studio frame and semantic tokens', () => {
  for (const source of [successPage, failPage]) {
    assert.match(source, /studio-theme/)
    assert.match(source, /StudioContainer/)
    assert.match(source, /var\(--studio-/)
    assert.doesNotMatch(source, /max-w-md|bg-gray-50|text-(?:blue|green|red|gray)-/)
  }
})
