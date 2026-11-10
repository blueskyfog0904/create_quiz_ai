import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadModule(path, modules) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  const stubRequire = (name) => {
    if (name === 'server-only') return {}
    if (name in modules) return modules[name]
    return require(name)
  }
  new Function('exports', 'require', code)(loaded.exports, stubRequire)
  return loaded.exports
}

const ok = (data) => ({ data, error: null })
const fail = (message, code = 'P0001') => ({ data: null, error: { code, message } })

// RPC와 profiles·notifications만 흉내 내는 가짜 service role 클라이언트.
function createFakeAdmin(rpc) {
  const calls = { rpc: [], alerts: [], profileUpdates: [] }
  const admin = {
    calls,
    from(table) {
      return {
        update(values) {
          if (table === 'profiles') calls.profileUpdates.push(values)
          return {
            eq: () => ({
              select: () => ({ single: async () => ({ data: { credits: values.credits }, error: null }) }),
            }),
          }
        },
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        insert: async () => ({ error: null }),
      }
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      if (name === 'record_payment_alert') calls.alerts.push(args)
      const handler = rpc[name]
      if (!handler) throw new Error(`unexpected rpc ${name}`)
      return handler(args)
    },
  }
  return admin
}

function loadCredits(admin) {
  const supabaseModules = {
    '@/lib/supabase/server': { createClient: async () => admin },
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
  }
  const creditBalance = loadModule('../src/lib/credit-balance.ts', supabaseModules)
  return loadModule('../src/lib/credits.ts', {
    ...supabaseModules,
    '@/lib/credit-balance': creditBalance,
  })
}

const snapshotFails = () => fail('snapshot unavailable')

test('a committed deduction is returned with the RPC balance even when the post-commit snapshot fails', async () => {
  const admin = createFakeAdmin({
    consume_credits: () => ok({ new_balance: 70, consumptions: [{ source_id: 'source-1', amount: 30 }] }),
    get_credit_balance_snapshot: snapshotFails,
  })
  const { CreditService } = loadCredits(admin)

  const result = await CreditService.deductCredits('user-1', 30, 'ai_generation', null, '문제 생성')
  assert.deepEqual(result, { success: true, newBalance: 70, consumptions: [{ sourceId: 'source-1', amount: 30 }] })
  assert.equal(admin.calls.profileUpdates.length, 0)
})

test('a committed refund is returned with the RPC balance even when the post-commit snapshot fails', async () => {
  const admin = createFakeAdmin({
    refund_credits: () => ok({ new_balance: 100, refunded: 30, skipped: 0 }),
    get_credit_balance_snapshot: snapshotFails,
  })
  const { CreditService } = loadCredits(admin)

  const balance = await CreditService.refundCredits(
    'user-1', 30, 'ai_generation_refund', 'job-1', '생성 실패 환불', [{ sourceId: 'source-1', amount: 30 }]
  )
  assert.equal(balance, 100)
  assert.equal(admin.calls.profileUpdates.length, 0)
  assert.equal(admin.calls.alerts.length, 0)
})

test('deduct and refund never write the profile balance cache themselves', async () => {
  const admin = createFakeAdmin({
    consume_credits: () => ok({ new_balance: 70, consumptions: [{ source_id: 'source-1', amount: 30 }] }),
    refund_credits: () => ok({ new_balance: 100, refunded: 30, skipped: 0 }),
    get_credit_balance_snapshot: () => ok({
      profile_balance: 100,
      ledger_balance: 100,
      spendable_balance: 100,
      expired_balance: 0,
      latest_transaction_balance: 100,
      next_expiration_at: null,
      database_now: '2026-11-10T00:00:00Z',
    }),
  })
  const { CreditService } = loadCredits(admin)

  await CreditService.deductCredits('user-1', 30, 'ai_generation', null, '문제 생성')
  await CreditService.refundCredits('user-1', 30, 'ai_generation_refund', null, '환불', [{ sourceId: 'source-1', amount: 30 }])
  assert.equal(admin.calls.profileUpdates.length, 0)
})

test('a refund RPC failure records one CREDIT_REFUND_FAILED alert per call and rethrows the original error', async () => {
  const admin = createFakeAdmin({
    refund_credits: () => fail('CREDIT_REFUND_SOURCE_NOT_FOUND'),
    record_payment_alert: () => ok(true),
  })
  const { CreditService } = loadCredits(admin)
  const refund = () => CreditService.refundCredits(
    'user-1', 30, 'listboard_batch_generation_retry_refund', 'job-1', '재시도 실패 환불', [{ sourceId: 'source-1', amount: 30 }]
  )

  await assert.rejects(refund(), { message: 'CREDIT_REFUND_SOURCE_NOT_FOUND' })
  assert.equal(admin.calls.alerts.length, 1)
  const [alert] = admin.calls.alerts
  assert.equal(alert.p_code, 'CREDIT_REFUND_FAILED')
  assert.equal(alert.p_severity, 'warning')
  assert.equal(alert.p_details.user_id, 'user-1')
  assert.equal(alert.p_details.resource_type, 'listboard_batch_generation_retry_refund')
  assert.equal(alert.p_details.resource_id, 'job-1')
  assert.equal(alert.p_details.amount, 30)
  assert.equal(alert.p_details.description, '재시도 실패 환불')
  assert.equal(alert.p_details.error_message, 'CREDIT_REFUND_SOURCE_NOT_FOUND')
  assert.match(alert.p_details.dedupe_key, /^credit_refund_failed:[0-9a-f-]{36}$/)

  // 같은 리소스로 다시 실패해도 키가 달라 두 번째 실패가 첫 경보에 묶이지 않는다.
  await assert.rejects(refund(), { message: 'CREDIT_REFUND_SOURCE_NOT_FOUND' })
  assert.equal(admin.calls.alerts.length, 2)
  assert.notEqual(admin.calls.alerts[0].p_details.dedupe_key, admin.calls.alerts[1].p_details.dedupe_key)
  assert.doesNotMatch(admin.calls.alerts[1].p_details.dedupe_key, /job-1/)
})

test('the original refund error is thrown even when the alert RPC fails', async () => {
  for (const alertResult of [() => { throw new Error('alert down') }, () => Promise.reject(new Error('alert down')), () => fail('alert failed')]) {
    const admin = createFakeAdmin({
      refund_credits: () => fail('connection reset'),
      record_payment_alert: alertResult,
    })
    const { CreditService } = loadCredits(admin)

    await assert.rejects(
      CreditService.refundCredits('user-1', 30, 'ai_generation_refund', null, '환불', [{ sourceId: 'source-1', amount: 30 }]),
      { message: 'connection reset' }
    )
    assert.equal(admin.calls.rpc.filter((call) => call.name === 'record_payment_alert').length, 1)
  }
})

test('a committed admin grant is returned with the RPC balance even when the post-commit snapshot fails', async () => {
  const admin = createFakeAdmin({
    grant_admin_credits: () => ok({ already_granted: false, source_id: 'source-9', new_balance: 500 }),
    get_credit_balance_snapshot: snapshotFails,
  })
  const { CreditService } = loadCredits(admin)

  const result = await CreditService.grantCreditsAsAdmin('user-1', 500, 'admin_grant', 'admin_grant', 'admin_grant:key')
  assert.deepEqual(result, { sourceId: 'source-9', newBalance: 500, alreadyGranted: false })
  assert.equal(admin.calls.profileUpdates.length, 0)
})
