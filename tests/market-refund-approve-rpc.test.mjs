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

const REQUEST = {
  id: 'request-1',
  status: 'pending',
  target_kind: 'v2_order',
  order_id: 'order-1',
  legacy_purchase_id: null,
  user_id: 'user-1',
  requested_refund_credits: 100,
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
function createWorld({ rpc, request = REQUEST } = {}) {
  const calls = { rpc: [], writes: [], balanceChecks: [] }
  const rows = {
    market_refund_requests: request,
    market_purchase_orders: ORDER,
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
    assert.match(error.message, /100크레딧 중 60크레딧만 되돌릴 수 있습니다/)
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
    '@/lib/market-refunds': {
      MarketRefundConflictError,
      MarketRefundShortfallError,
      rejectMarketRefund: async () => ({}),
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
  assert.match(client, /JSON\.stringify\(\{ action, confirmedRefundCredits \}\)/)
  assert.match(client, /send\(shortfall\.restorable\)/)
})
