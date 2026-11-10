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

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const routeSource = readSource('../src/app/api/admin/users/credits/route.ts')
const usersClient = readSource('../src/app/(admin)/admin/users/users-client.tsx')
const grantDialog = readSource('../src/app/(admin)/admin/credits/grant-credit-dialog.tsx')

const KEY = '0f8fad5b-d9cb-469f-a165-70867728950e'
const USER_ID = '00000000-0000-4000-8000-000000000002'

function loadRoute(grant) {
  const calls = { grants: [], notifications: [] }
  const route = loadModule('../src/app/api/admin/users/credits/route.ts', {
    'next/server': {
      NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
        from: (table) => ({
          select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: true } }) }) }),
          insert: async (row) => {
            if (table === 'notifications') calls.notifications.push(row)
            return { error: null }
          },
        }),
      }),
    },
    '@/lib/credits': {
      CreditService: {
        grantCreditsAsAdmin: async (...args) => {
          calls.grants.push(args)
          return grant(...args)
        },
      },
    },
    '@/lib/credit-source-display': loadModule('../src/lib/credit-source-display.ts', {}),
    '@/lib/credit-balance': {
      getCreditBalanceSnapshot: async () => ({}),
      buildCreditBalanceResponseFields: () => ({}),
    },
  })
  const post = (body) => route.POST({ json: async () => body })
  return { calls, post }
}

const body = (overrides = {}) => ({
  userId: USER_ID,
  amount: 500,
  description: '보상 지급',
  category: 'compensation',
  idempotencyKey: KEY,
  ...overrides,
})

test('the grant route requires a uuid idempotencyKey', async () => {
  assert.match(routeSource, /idempotencyKey: z\.string\(\)\.uuid\(\)/)
  const { calls, post } = loadRoute(async () => ({ sourceId: 's', newBalance: 500, alreadyGranted: false }))

  for (const idempotencyKey of [undefined, 'not-a-uuid']) {
    const response = await post(body({ idempotencyKey }))
    assert.equal(response.status, 400)
  }
  assert.equal(calls.grants.length, 0)
})

test('the grant route passes an admin_grant: operation key and notifies only a new grant', async () => {
  const { calls, post } = loadRoute(async () => ({ sourceId: 's', newBalance: 500, alreadyGranted: calls.grants.length > 1 }))

  const first = await post(body())
  assert.equal(first.status, 200)
  assert.deepEqual(calls.grants[0], [USER_ID, 500, 'admin_grant', 'admin_grant', `admin_grant:${KEY}`])
  assert.equal(calls.notifications.length, 1)

  // 응답 유실 뒤 같은 키로 다시 보내면 성공을 응답하지만 사용자 알림은 다시 보내지 않는다.
  const repeated = await post(body())
  assert.equal(repeated.status, 200)
  assert.equal(repeated.body.success, true)
  assert.equal(calls.notifications.length, 1)
})

test('the grant route answers ADMIN_GRANT_IDEMPOTENCY_CONFLICT with 409', async () => {
  const { calls, post } = loadRoute(async () => {
    throw new Error('ADMIN_GRANT_IDEMPOTENCY_CONFLICT')
  })

  const response = await post(body())
  assert.equal(response.status, 409)
  assert.equal(response.body.error, '이전 요청과 내용이 다릅니다. 창을 닫고 다시 열어 지급하세요.')
  assert.equal(calls.notifications.length, 0)
})

test('grantCreditsAsAdmin calls grant_admin_credits with the operation key and maps a conflict', async () => {
  const rpcCalls = []
  let response = { data: { already_granted: true, source_id: 'source-1', new_balance: 800 }, error: null }
  const admin = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (name === 'get_credit_balance_snapshot') return { data: null, error: { message: 'down' } }
      return response
    },
  }
  const { CreditService } = loadModule('../src/lib/credits.ts', {
    '@/lib/supabase/server': { createClient: async () => admin },
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/credit-balance': {
      getCreditBalanceSnapshot: async () => {
        throw new Error('down')
      },
      reportCreditBalanceMismatch: async () => undefined,
      syncProfileBalanceCacheFromLedger: async () => {
        throw new Error('must not sync')
      },
    },
  })

  const result = await CreditService.grantCreditsAsAdmin(USER_ID, 300, 'bonus', 'admin_grant', `admin_grant:${KEY}`)
  assert.deepEqual(result, { sourceId: 'source-1', newBalance: 800, alreadyGranted: true })
  assert.deepEqual(rpcCalls[0], {
    name: 'grant_admin_credits',
    args: {
      p_user_id: USER_ID,
      p_amount: 300,
      p_source_category: 'bonus',
      p_payment_method: 'admin_grant',
      p_operation_key: `admin_grant:${KEY}`,
    },
  })

  response = { data: null, error: { message: 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT' } }
  await assert.rejects(
    CreditService.grantCreditsAsAdmin(USER_ID, 300, 'bonus', 'admin_grant', `admin_grant:${KEY}`),
    { message: 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT' }
  )
})

test('both admin grant screens send a crypto.randomUUID() key and renew it after success', () => {
  for (const source of [usersClient, grantDialog]) {
    assert.match(source, /crypto\.randomUUID\(\)/)
    assert.match(source, /idempotencyKey/)
    assert.match(source, /toast\.success[\s\S]*?crypto\.randomUUID\(\)/)
  }
  assert.match(usersClient, /idempotencyKey: grantIdempotencyKey/)
  assert.match(usersClient, /openGrantModal = \(user: Profile\) => \{[\s\S]*?setGrantIdempotencyKey\(crypto\.randomUUID\(\)\)/)
  assert.match(grantDialog, /handleUserSelect = \(user: Profile\) => \{[\s\S]*?setIdempotencyKey\(crypto\.randomUUID\(\)\)/)
  assert.match(grantDialog, /category,\s*idempotencyKey\s*\}/)
})
