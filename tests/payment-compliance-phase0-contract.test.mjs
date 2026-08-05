import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const purchaseRoute = read('../src/app/api/credits/purchase/route.ts')
const deductRoute = read('../src/app/api/credits/deduct/route.ts')
const profileRoute = read('../src/app/api/profile/route.ts')
const creditsService = read('../src/lib/credits.ts')
const pointChargeRefunds = read('../src/lib/point-charge-refunds-server.ts')
const profileClient = read('../src/app/(dashboard)/mypage/profile/profile-client.tsx')
const signupPage = read('../src/app/(auth)/signup/page.tsx')
const hardeningMigration = read(
  '../supabase/migrations/20260805090000_harden_credit_mutation_boundaries.sql'
)

test('unsafe credit mutation routes are disabled before payment rollout', () => {
  assert.match(purchaseRoute, /status:\s*410/)
  assert.match(deductRoute, /status:\s*410/)
  assert.doesNotMatch(purchaseRoute, /CreditService\.purchaseCredits/)
  assert.doesNotMatch(deductRoute, /CreditService\.deductCredits/)
})

test('credit mutations use the server-only service role boundary', () => {
  assert.match(creditsService, /import 'server-only'/)
  assert.match(creditsService, /createAdminClient\(\)/)
  assert.match(
    creditsService,
    /static async deductCredits[\s\S]*?const (?:supabase|adminSupabase) = createAdminClient\(\)/
  )
  assert.match(
    creditsService,
    /static async refundCredits[\s\S]*?const (?:supabase|adminSupabase) = createAdminClient\(\)/
  )
  assert.match(pointChargeRefunds, /createPaymentAdminClient\(\)/)
})

test('profile mutations go through an authenticated Zod allowlist route', () => {
  assert.match(profileRoute, /auth\.getUser\(\)/)
  assert.match(profileRoute, /z\.discriminatedUnion/)
  assert.match(profileRoute, /update_phone/)
  assert.match(profileRoute, /complete_kakao_signup/)
  assert.match(profileRoute, /createAdminClient\(\)/)
  assert.match(profileClient, /fetch\('\/api\/profile'/)
  assert.doesNotMatch(profileClient, /\.from\('profiles'\)[\s\S]{0,160}\.update\(/)
  assert.match(signupPage, /fetch\('\/api\/profile'/)
  assert.doesNotMatch(signupPage, /\.from\('profiles'\)[\s\S]{0,220}\.update\(/)
})

test('database hardening revokes browser writes and unsafe RPC execution', () => {
  assert.match(
    hardeningMigration,
    /revoke\s+(?:insert,\s*update,\s*delete|all)[\s\S]*credit_sources[\s\S]*from\s+public,\s*anon,\s*authenticated/i
  )
  assert.match(
    hardeningMigration,
    /revoke\s+execute\s+on\s+function\s+public\.consume_credits[\s\S]*from\s+public,\s*anon,\s*authenticated/i
  )
  assert.match(
    hardeningMigration,
    /grant\s+execute\s+on\s+function\s+public\.consume_credits[\s\S]*to\s+service_role/i
  )
  assert.match(
    hardeningMigration,
    /revoke\s+update[\s\S]*profiles[\s\S]*from\s+public,\s*anon,\s*authenticated/i
  )
})
