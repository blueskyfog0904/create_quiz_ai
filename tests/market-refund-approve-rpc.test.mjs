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
    // 8번: 순수 규칙 모듈(마감·차단 범위)은 실제 파일을 쓴다.
    if (name === '@/lib/market-refund-rules') return loadModule('../src/lib/market-refund-rules.ts', {})
    return require(name)
  }
  new Function('exports', 'require', code)(loaded.exports, stubRequire)
  return loaded.exports
}

const REQUEST = {
  id: 'request-1',
  status: 'pending',
  target_kind: 'v2_order',
  order_id: 'order-1',
  legacy_purchase_id: null,
  user_id: 'user-1',
  requested_refund_credits: 100,
  created_at: new Date().toISOString(),
}

const ORDER = {
  id: 'order-1',
  user_id: 'user-1',
  item_id: 'item-1',
  workspace_subject: 'english',
  created_at: new Date().toISOString(),
  status: 'completed',
  charged_credits: 100,
  credit_consumptions: [{ sourceId: 'source-1', amount: 100 }],
}

// 사전 검사 조회(요청·주문·다운로드·이용권)와 RPC만 흉내 낸다. 테이블 쓰기는 기록만 한다.
function createWorld({ rpc, request = REQUEST, order = ORDER, refundPolicy = { refundDays: 7, refundExpiredReason: '구매 후 {자료환불기간}일이 지난 자료는 환불할 수 없습니다.' } } = {}) {
  const calls = { rpc: [], writes: [], balanceChecks: [] }
  const rows = {
    market_refund_requests: request,
    market_purchase_orders: order,
  }

  const query = (table) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      then: (resolve) => resolve(table === 'market_download_events'
        ? { count: 0, error: null }
        : { data: [], error: null }),
      update: (values) => {
        calls.writes.push({ table, values })
        return chain
      },
      insert: (values) => {
        calls.writes.push({ table, values })
        return chain
      },
    }
    return chain
  }

  const admin = {
    from: query,
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      return rpc(args)
    },
  }

  const marketRefunds = loadModule('../src/lib/market-refunds.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/credits': {
      reportCreditBalanceAfterMutation: async (userId, context) => {
        calls.balanceChecks.push({ userId, context })
      },
    },
    '@/lib/workspace-subject': { DEFAULT_WORKSPACE_SUBJECT: 'english' },
    '@/lib/market-purchase-policy': loadModule('../src/lib/market-purchase-policy.ts', {}),
    // 환불 기간 설정(DB system_settings) — 승인 사전 검사가 캐시 없이 읽는다.
    '@/lib/market-purchase-policy-server': {
      readMarketRefundPolicyUncached: async () => refundPolicy,
      getMarketRefundPolicyCached: async () => refundPolicy,
    },
  })

  return {
    calls,
    marketRefunds,
    approve: (input = {}) => marketRefunds.approveMarketRefund({
      requestId: 'request-1',
      adminId: 'admin-1',
      adminNote: null,
      ...input,
    }),
  }
}

const rpcError = (message, extra = {}) => ({ data: null, error: { code: 'P0001', message, details: null, ...extra } })

test('approveMarketRefund calls approve_market_refund once and never updates tables directly', async () => {
  const world = createWorld({
    rpc: () => ({ data: { ...REQUEST, status: 'approved', approved_refund_credits: 100, new_balance: 300, shortfall: 0 }, error: null }),
  })

  const result = await world.approve({ adminNote: '확인 완료' })
  assert.equal(result.status, 'approved')
  assert.equal(world.calls.rpc.length, 1)
  assert.equal(world.calls.rpc[0].name, 'approve_market_refund')
  assert.deepEqual(world.calls.rpc[0].args, {
    p_request_id: 'request-1',
    p_admin_id: 'admin-1',
    p_admin_note: '확인 완료',
    p_confirmed_refund_credits: null,
  })
  assert.equal(world.calls.writes.length, 0)
  assert.deepEqual(world.calls.balanceChecks, [{ userId: 'user-1', context: 'Market refund' }])
})

test('confirmedRefundCredits is passed as p_confirmed_refund_credits', async () => {
  const world = createWorld({ rpc: () => ({ data: { ...REQUEST, status: 'approved' }, error: null }) })

  await world.approve({ confirmedRefundCredits: 0 })
  assert.equal(world.calls.rpc[0].args.p_confirmed_refund_credits, 0)

  await world.approve({ confirmedRefundCredits: 60 })
  assert.equal(world.calls.rpc[1].args.p_confirmed_refund_credits, 60)
})

test('MARKET_REFUND_NOT_PENDING becomes a MarketRefundConflictError', async () => {
  const world = createWorld({ rpc: () => rpcError('MARKET_REFUND_NOT_PENDING') })

  await assert.rejects(world.approve(), (error) => {
    assert.ok(error instanceof world.marketRefunds.MarketRefundConflictError)
    assert.equal(error.message, '이미 처리된 환불 요청입니다.')
    return true
  })
  assert.equal(world.calls.balanceChecks.length, 0)
})

test('MARKET_REFUND_TARGET_CHANGED tells the admin the conditions changed', async () => {
  const world = createWorld({ rpc: () => rpcError('MARKET_REFUND_TARGET_CHANGED') })

  await assert.rejects(world.approve(), { message: '승인 전 환불 조건이 변경되었습니다.' })
})

test('MARKET_REFUND_SHORTFALL becomes a MarketRefundShortfallError carrying both numbers', async () => {
  const world = createWorld({
    rpc: () => rpcError('MARKET_REFUND_SHORTFALL', { details: JSON.stringify({ requested: 100, restorable: 60 }) }),
  })

  await assert.rejects(world.approve(), (error) => {
    assert.ok(error instanceof world.marketRefunds.MarketRefundShortfallError)
    assert.equal(error.requested, 100)
    assert.equal(error.restorable, 60)
    // 8번: 기간이 지난 몫은 다시 지급하므로 '돌려줄 수 있음'으로 안내한다.
    assert.match(error.message, /100크레딧 중 60크레딧만 돌려줄 수 있습니다/)
    return true
  })
})

test('deadlock and serialization failures ask the admin to retry', async () => {
  for (const code of ['40P01', '40001']) {
    const world = createWorld({ rpc: () => rpcError('deadlock detected', { code }) })

    await assert.rejects(world.approve(), (error) => {
      assert.ok(error instanceof world.marketRefunds.MarketRefundConflictError)
      assert.match(error.message, /잠시 후 다시 시도/)
      return true
    })
  }
})

test('the admin route answers a shortfall with 409 and the numbers, and forwards the confirmation', async () => {
  const { MarketRefundShortfallError, MarketRefundConflictError } = createWorld({ rpc: () => null }).marketRefunds
  const approveCalls = []
  const route = loadModule('../src/app/api/admin/market/refunds/[id]/route.ts', {
    ...adminGuardMocks({ userId: 'admin-1' }),
    'next/server': {
      NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
        from: () => ({
          select: () => ({ eq: () => ({ single: async () => ({ data: { is_admin: true } }) }) }),
        }),
      }),
    },
    // 승인 성공 뒤 회원 알림 INSERT(W3-8b)가 쓰는 클라이언트
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        from: () => ({
          // 처리 전 본인 요청 확인이 읽는 요청(다른 회원의 요청)
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'member-1', requested_refund_credits: 100 }, error: null }) }) }),
          insert: async () => ({ error: null }),
        }),
      }),
    },
    '@/lib/market-refunds': {
      MarketRefundConflictError,
      MarketRefundShortfallError,
      rejectMarketRefund: async () => ({}),
      MARKET_REFUND_REJECT_CODES: ['TARGET_CHANGED', 'PROVIDED_CONFIRMED', 'OTHER'],
      MarketRefundNeedsOwnerError: class extends Error {},
      MarketRefundRuleError: class extends Error {},
      settleMarketRefundByOwner: async () => ({}),
      getMarketRefundOwnerContext: async () => null,
      approveMarketRefund: async (input) => {
        approveCalls.push(input)
        if (input.confirmedRefundCredits === undefined) throw new MarketRefundShortfallError(100, 60)
        return { id: 'request-1', status: 'approved' }
      },
    },
  })
  const patch = (body) => route.PATCH(
    { json: async () => body },
    { params: Promise.resolve({ id: 'request-1' }) }
  )

  const shortfall = await patch({ action: 'approve' })
  assert.equal(shortfall.status, 409)
  assert.equal(shortfall.body.code, 'MARKET_REFUND_SHORTFALL')
  assert.equal(shortfall.body.requested, 100)
  assert.equal(shortfall.body.restorable, 60)

  const confirmed = await patch({ action: 'approve', confirmedRefundCredits: 60 })
  assert.equal(confirmed.status, 200)
  assert.equal(approveCalls[1].confirmedRefundCredits, 60)

  const invalid = await patch({ action: 'approve', confirmedRefundCredits: -1 })
  assert.equal(invalid.status, 400)
})

test('the admin screen confirms a shortfall and resends with confirmedRefundCredits', () => {
  const client = readFileSync(new URL('../src/app/(admin)/admin/refunds/market-refunds-client.tsx', import.meta.url), 'utf8')
  assert.match(client, /result\?\.code === 'MARKET_REFUND_SHORTFALL'/)
  assert.match(client, /window\.confirm\(/)
  assert.match(client, /JSON\.stringify\(\{\s*action,\s*confirmedRefundCredits,\s*adminNote: adminNote\.trim\(\) \|\| undefined,/)
  assert.match(client, /send\(shortfall\.restorable\)/)
})

// 7번 묶음: 환불 기간은 DB 값, 관리자 승인은 신청 시각 기준, 설정을 못 읽으면 승인하지 않는다.
const DAY = 24 * 60 * 60 * 1000
const approvedRpc = () => ({ data: { ...REQUEST, status: 'approved' }, error: null })

test('환불 기간 설정을 읽지 못하면 RPC 를 부르지 않고 REFUND_POLICY_UNAVAILABLE 로 멈춘다', async () => {
  const world = createWorld({ rpc: approvedRpc, refundPolicy: null })
  await assert.rejects(world.approve(), (error) => error.name === 'REFUND_POLICY_UNAVAILABLE')
  assert.equal(world.calls.rpc.length, 0)
})

test('기간 안에 낸 신청은 기간이 지난 뒤 승인해도 통과한다(신청 시각 기준)', async () => {
  const purchasedAt = new Date(Date.now() - 10 * DAY).toISOString()
  const world = createWorld({
    rpc: approvedRpc,
    order: { ...ORDER, created_at: purchasedAt },
    request: { ...REQUEST, created_at: new Date(Date.now() - 7 * DAY).toISOString() },
  })
  const result = await world.approve()
  assert.equal(result.status, 'approved')
  assert.equal(world.calls.rpc.length, 1)
})

test('기간이 지난 뒤 낸 신청은 DB 문구(채운 기간)로 거절하고 RPC 를 부르지 않는다', async () => {
  const world = createWorld({
    rpc: approvedRpc,
    order: { ...ORDER, created_at: new Date(Date.now() - 10 * DAY).toISOString() },
    request: { ...REQUEST, created_at: new Date(Date.now() - 1 * DAY).toISOString() },
  })
  await assert.rejects(world.approve(), /구매 후 7일이 지난 자료는 환불할 수 없습니다\./)
  assert.equal(world.calls.rpc.length, 0)
})

test('신청 시각을 읽을 수 없으면 승인하지 않는다', async () => {
  const world = createWorld({ rpc: approvedRpc, request: { ...REQUEST, created_at: null } })
  await assert.rejects(world.approve(), /신청 시각을 확인할 수 없어/)
  assert.equal(world.calls.rpc.length, 0)
})
