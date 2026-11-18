import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { adminGuardMocks } from './helpers/market-images-harness.mjs'

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
const ACTOR_ID = '00000000-0000-4000-8000-000000000001'

function loadRoute(grant) {
  const calls = { grants: [], notifications: [] }
  const route = loadModule('../src/app/api/admin/users/credits/route.ts', {
    ...adminGuardMocks({ userId: 'admin-1' }),
    'next/server': {
      NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    },
    // 회원 알림은 서버 키(bypass)로 넣는다. 관리자 세션 클라이언트는 쓰지 않는다.
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        from: (table) => ({
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
  assert.deepEqual(calls.grants[0], [{
    actorId: 'admin-1',
    userId: USER_ID,
    credits: 500,
    sourceCategory: 'admin_grant',
    reason: '보상 지급',
    details: { category: 'compensation' },
    operationKey: `admin_grant:${KEY}`,
  }])
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
  assert.equal(response.body.error, '이 창에서 보낸 이전 지급이 이미 처리되었습니다. 지급 내역을 먼저 확인하고, 추가 지급이 필요할 때만 창을 닫고 다시 열어 지급하세요.')
  assert.equal(calls.notifications.length, 0)
})

test('grantCreditsAsAdmin calls grant_admin_credits(7 args, actor included) with the operation key and passes known rejections through', async () => {
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

  const GRANT_ARGS = { actorId: ACTOR_ID, userId: USER_ID, credits: 300, sourceCategory: 'bonus', reason: '보상', details: { category: 'event' }, operationKey: `admin_grant:${KEY}` }
  const result = await CreditService.grantCreditsAsAdmin(GRANT_ARGS)
  assert.deepEqual(result, { sourceId: 'source-1', newBalance: 800, alreadyGranted: true })
  assert.deepEqual(rpcCalls[0], {
    name: 'grant_admin_credits',
    args: {
      p_actor_id: ACTOR_ID,
      p_user_id: USER_ID,
      p_amount: 300,
      p_source_category: 'bonus',
      p_reason: '보상',
      p_details: { category: 'event' },
      p_operation_key: `admin_grant:${KEY}`,
    },
  })

  response = { data: null, error: { message: 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT' } }
  await assert.rejects(
    CreditService.grantCreditsAsAdmin(GRANT_ARGS),
    { message: 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT' }
  )
  // 한도 거부는 숫자까지 넘기고(route가 안내 문구로 바꾼다), 모르는 오류는 일반 문구로 감춘다.
  response = { data: null, error: { message: 'ADMIN_GRANT_LIMIT_PER_DAY limit=50000 used=49000' } }
  await assert.rejects(CreditService.grantCreditsAsAdmin(GRANT_ARGS), { message: 'ADMIN_GRANT_LIMIT_PER_DAY limit=50000 used=49000' })
  response = { data: null, error: { message: 'relation "x" does not exist' } }
  await assert.rejects(CreditService.grantCreditsAsAdmin(GRANT_ARGS), { message: '관리자 크레딧 지급 중 오류가 발생했습니다.' })
})

test('the admin grant dialog sends a crypto.randomUUID() key and renews it after success; the users screen reuses that dialog', () => {
  assert.match(grantDialog, /crypto\.randomUUID\(\)/)
  assert.match(grantDialog, /idempotencyKey/)
  assert.match(grantDialog, /toast\.success[\s\S]*?crypto\.randomUUID\(\)/)
  // 사용자 관리 화면은 자체 지급 창 없이 같은 대화상자를 쓴다(확인 단계·분류·중복 방지 키가 한 곳에만 있다).
  assert.match(usersClient, /<GrantCreditDialog/)
  assert.doesNotMatch(usersClient, /\/api\/admin\/users\/credits/)
  // 창을 열 때만 키를 만든다. 응답 유실 뒤 같은 창에서 대상을 다시 골라도 같은 키를 보낸다.
  assert.match(grantDialog, /useEffect\(\(\) => \{\s*if \(open\) \{\s*setIdempotencyKey\(crypto\.randomUUID\(\)\)\s*\}/)
  const userSelect = grantDialog.match(/handleUserSelect = \(user: Profile\) => \{[\s\S]*?\n  \}/)
  assert.ok(userSelect)
  assert.doesNotMatch(userSelect[0], /setIdempotencyKey/)
  // 키를 바꾸는 곳은 창을 열 때와 지급 성공 직후 두 곳뿐이다.
  assert.equal(grantDialog.match(/setIdempotencyKey\(/g).length, 2)
  assert.match(grantDialog, /category,\s*idempotencyKey\s*\}/)
})
