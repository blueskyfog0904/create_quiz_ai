import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const lib = read('src/lib/admin-dashboard-server.ts')
const route = read('src/app/api/admin/stats/route.ts')
const page = read('src/app/(admin)/admin/page.tsx')
const dashboard = read('src/app/(admin)/admin/dashboard-client.tsx')

const permissions = load('src/lib/admin-permissions.ts')
const readAllQueryRows = load('src/lib/read-all-query-rows.ts')
const { getKstPeriodStarts } = load('src/lib/kst-period.ts')

const owner = { userId: 'admin-1', role: 'owner', grants: {} }
const staff = (...keys) => ({ userId: 'admin-2', role: 'staff', grants: Object.fromEntries(keys.map((key) => [key, {}])) })

// 한국 시간 2026-11-17 15:00. 오늘 시작 = 11-16T15:00Z, 이번 달 시작 = 10-31T15:00Z
const period = getKstPeriodStarts(new Date('2026-11-17T06:00:00Z'))
const TODAY = '2026-11-17T01:00:00+00:00'
const EARLIER_THIS_MONTH = '2026-11-03T01:00:00+00:00'
const LAST_MONTH = '2026-10-20T01:00:00+00:00'

const valueAt = (row, column) => column.split('.').reduce((value, key) => value?.[key], row)

// 가짜 DB: 표의 행에 eq·in·gte·range·limit을 실제로 적용해 돌려준다. failTables에 든 표는 조회가 실패한다.
function loadDashboard({ rowsByTable = {}, failTables = [] } = {}) {
  const queries = []
  const errors = []
  const handler = (client) => ({ table, ops }) => {
    queries.push({ client, table, ops })
    if (failTables.includes(table)) return { data: null, count: null, error: { message: `${table} failed` } }
    let rows = rowsByTable[table] ?? []
    for (const [name, column, value] of ops) {
      if (name === 'eq') rows = rows.filter((row) => valueAt(row, column) === value)
      if (name === 'in') rows = rows.filter((row) => value.includes(valueAt(row, column)))
      if (name === 'gte') rows = rows.filter((row) => Date.parse(valueAt(row, column)) >= Date.parse(value))
    }
    const range = op(ops, 'range')
    const limit = op(ops, 'limit')
    if (op(ops, 'select')?.[2]?.head) return { data: null, count: rows.length, error: null }
    if (range) rows = rows.slice(range[1], range[2] + 1)
    if (limit) rows = rows.slice(0, limit[1])
    return { data: rows, error: null }
  }
  const { client: admin } = createFakeAdmin(handler('admin'))
  const { client: paymentAdmin } = createFakeAdmin(handler('payment'))
  const server = load('src/lib/admin-dashboard-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => paymentAdmin },
    '@/lib/read-all-query-rows': readAllQueryRows,
    '@/lib/admin-permissions': permissions,
  }, errors)
  return { server, queries, errors }
}

const paymentOrder = (overrides = {}) => ({
  id: 'p', order_id: 'ORD-1', user_id: 'u1', status: 'completed', provider_environment: 'live',
  plan_name_snapshot: '기본', expected_amount: 10000, approved_at: TODAY, created_at: TODAY, user: { email: 'a@example.com' },
  ...overrides,
})

test('충전 결제 합계: 1000행이 넘어도 끝까지 나눠 읽어 더한다', async () => {
  const orders = Array.from({ length: 1234 }, (_, index) => paymentOrder({ id: `p${index}`, expected_amount: 1000 }))
  const { server, queries } = loadDashboard({ rowsByTable: { payment_orders: orders } })
  const { metrics } = await server.getAdminDashboard(owner, period)

  assert.deepEqual(metrics.payment.month, { count: 1234, amount: 1_234_000 })
  const ranges = queries
    .filter((query) => query.table === 'payment_orders' && op(query.ops, 'range'))
    .map((query) => op(query.ops, 'range').slice(1))
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]])
  // 나눠 읽을 때 순서가 흔들리지 않게 고유 키로 정렬한다.
  for (const query of queries.filter((item) => op(item.ops, 'range'))) {
    assert.deepEqual(op(query.ops, 'order'), ['order', 'id'])
  }
})

test('충전 결제: 실결제의 completed·refunded만, 결제 승인 시각으로 오늘·이번 달을 가른다', async () => {
  const { server, queries } = loadDashboard({
    rowsByTable: {
      payment_orders: [
        paymentOrder({ id: 'today', expected_amount: 5000, approved_at: TODAY }),
        // 지난달에 만든 주문이라도 이번 달에 승인됐으면 이번 달 결제다.
        paymentOrder({ id: 'month', expected_amount: 7000, approved_at: EARLIER_THIS_MONTH, created_at: LAST_MONTH }),
        paymentOrder({ id: 'refunded', status: 'refunded', expected_amount: 3000, approved_at: EARLIER_THIS_MONTH }),
        paymentOrder({ id: 'test', provider_environment: 'test', expected_amount: 900_000, approved_at: TODAY }),
        paymentOrder({ id: 'old', expected_amount: 800_000, approved_at: LAST_MONTH }),
        paymentOrder({ id: 'unpaid', status: 'ready', expected_amount: 700_000, approved_at: null }),
      ],
    },
  })
  const { metrics, recentOrders } = await server.getAdminDashboard(owner, period)

  assert.deepEqual(metrics.payment, { today: { count: 1, amount: 5000 }, month: { count: 3, amount: 15000 } })
  // 최근 주문에도 테스트 환경 주문은 없다(결제 전 주문은 보인다).
  assert.deepEqual(recentOrders.data.map((order) => order.id).includes('test'), false)
  assert.equal(recentOrders.data.length, 5)

  for (const query of queries.filter((item) => item.table === 'payment_orders')) {
    assert.equal(query.client, 'payment')
    assert.deepEqual(op(query.ops, 'eq'), ['eq', 'provider_environment', 'live'])
  }
  const totals = queries.find((query) => query.table === 'payment_orders' && op(query.ops, 'range'))
  assert.deepEqual(op(totals.ops, 'in'), ['in', 'status', ['completed', 'refunded']])
  assert.deepEqual(op(totals.ops, 'gte'), ['gte', 'approved_at', period.monthStart])
})

test('충전 환불: 실결제 주문의 완료된 환불만, 환불 처리 시각 기준으로 더한다', async () => {
  const refund = (overrides = {}) => ({ status: 'completed', refund_amount: 1000, processed_at: TODAY, order: { provider_environment: 'live' }, ...overrides })
  const { server, queries } = loadDashboard({
    rowsByTable: {
      refund_requests: [
        refund({ refund_amount: 4000 }),
        refund({ refund_amount: 6000, processed_at: EARLIER_THIS_MONTH }),
        refund({ refund_amount: 500_000, order: { provider_environment: 'test' } }),
        refund({ refund_amount: 400_000, status: 'pending_review', processed_at: null }),
        refund({ refund_amount: 300_000, processed_at: LAST_MONTH }),
      ],
    },
  })
  const { metrics } = await server.getAdminDashboard(owner, period)
  assert.deepEqual(metrics.refundAmount, { today: 4000, month: 10000 })

  const query = queries.find((item) => item.table === 'refund_requests')
  assert.equal(query.client, 'payment')
  // 주문이 실결제인 환불만 남도록 주문을 inner로 묶는다.
  assert.match(op(query.ops, 'select')[1], /order:payment_orders!refund_requests_payment_order_id_fkey!inner\(provider_environment\)/)
  assert.ok(query.ops.some(([name, column, value]) => name === 'eq' && column === 'order.provider_environment' && value === 'live'))
})

test('충전 환불: 금액이 빈 완료 환불이 섞이면 틀린 합 대신 확인 불가(null)', async () => {
  const { server } = loadDashboard({
    rowsByTable: { refund_requests: [{ status: 'completed', refund_amount: null, processed_at: TODAY, order: { provider_environment: 'live' } }] },
  })
  const { metrics } = await server.getAdminDashboard(owner, period)
  assert.equal(metrics.refundAmount, null)
  assert.deepEqual(metrics.payment, { today: { count: 0, amount: 0 }, month: { count: 0, amount: 0 } })
})

test('마켓 판매: completed만 건수·크레딧에 넣고 환불·회수는 따로 센다. 다운로드는 건수만 센다', async () => {
  const purchase = (overrides = {}) => ({ status: 'completed', charged_credits: 10, created_at: TODAY, ...overrides })
  const { server, queries } = loadDashboard({
    rowsByTable: {
      market_purchase_orders: [
        purchase({ charged_credits: 30 }),
        purchase({ charged_credits: 20, created_at: EARLIER_THIS_MONTH }),
        purchase({ status: 'refunded', charged_credits: 500 }),
        purchase({ status: 'revoked', charged_credits: 500, created_at: EARLIER_THIS_MONTH }),
        purchase({ status: 'failed', charged_credits: 900 }),
        purchase({ charged_credits: 900, created_at: LAST_MONTH }),
      ],
      market_download_events: [{ created_at: TODAY }, { created_at: TODAY }, { created_at: EARLIER_THIS_MONTH }, { created_at: LAST_MONTH }],
    },
  })
  const { metrics } = await server.getAdminDashboard(owner, period)
  assert.deepEqual(metrics.market, {
    today: { count: 1, credits: 30, refundedCount: 1 },
    month: { count: 2, credits: 50, refundedCount: 2 },
  })
  assert.deepEqual(metrics.downloads, { today: 2, month: 3 })

  const downloadQueries = queries.filter((query) => query.table === 'market_download_events')
  assert.equal(downloadQueries.length, 2)
  for (const query of downloadQueries) {
    assert.deepEqual(op(query.ops, 'select'), ['select', 'id', { count: 'exact', head: true }])
  }
})

test('권한: 없는 구역은 조회 자체를 하지 않는다', async () => {
  const none = loadDashboard()
  assert.deepEqual(await none.server.getAdminDashboard(staff(), period), { metrics: null, recentOrders: null, recentTickets: null })
  assert.equal(none.queries.length, 0)

  const support = loadDashboard()
  const supportResult = await support.server.getAdminDashboard(staff('support.manage'), period)
  assert.equal(supportResult.metrics, null)
  assert.equal(supportResult.recentOrders, null)
  assert.deepEqual(supportResult.recentTickets, { failed: false, data: [] })
  assert.deepEqual(support.queries.map((query) => query.table), ['support_tickets'])

  const orders = loadDashboard()
  const ordersResult = await orders.server.getAdminDashboard(staff('orders.view'), period)
  assert.notEqual(ordersResult.metrics, null)
  assert.deepEqual(ordersResult.recentOrders, { failed: false, data: [] })
  assert.equal(ordersResult.recentTickets, null)
  assert.equal(orders.queries.some((query) => query.table === 'support_tickets'), false)

  // reports.view만 있고 orders.view가 없는 조합은 매출을 볼 수 없다.
  const reportsOnly = loadDashboard()
  assert.equal((await reportsOnly.server.getAdminDashboard(staff('reports.view'), period)).metrics, null)
  assert.equal(reportsOnly.queries.length, 0)
})

test('항목 하나가 실패하면 그 항목만 null(확인 불가)이고 나머지는 그대로다', async () => {
  const { server, errors } = loadDashboard({
    failTables: ['market_purchase_orders', 'support_tickets'],
    rowsByTable: {
      payment_orders: [paymentOrder({ expected_amount: 5000 })],
      market_download_events: [{ created_at: TODAY }],
    },
  })
  const result = await server.getAdminDashboard(owner, period)
  assert.equal(result.metrics.market, null)
  assert.deepEqual(result.metrics.payment.today, { count: 1, amount: 5000 })
  assert.deepEqual(result.metrics.refundAmount, { today: 0, month: 0 })
  assert.deepEqual(result.metrics.downloads, { today: 1, month: 1 })
  assert.deepEqual(result.recentTickets, { failed: true })
  assert.equal(result.recentOrders.failed, false)
  assert.equal(errors.length, 2)
})

test('최근 문의: 최근 5건, 회원이 삭제한 문의는 빼고 본문은 읽지 않는다', async () => {
  const tickets = Array.from({ length: 7 }, (_, index) => ({ id: `t${index}`, subject: `문의 ${index}`, is_deleted_by_user: index === 0 }))
  const { server, queries } = loadDashboard({ rowsByTable: { support_tickets: tickets } })
  const { recentTickets } = await server.getAdminDashboard(owner, period)
  assert.deepEqual(recentTickets.data.map((ticket) => ticket.id), ['t1', 't2', 't3', 't4', 't5'])
  const query = queries.find((item) => item.table === 'support_tickets')
  assert.doesNotMatch(op(query.ops, 'select')[1], /message|admin_response|\*/)
  assert.deepEqual(query.ops.filter(([name]) => name === 'order').map(([, column]) => column), ['created_at', 'id'])
})

test('조회 전용이고, 결제 lib은 읽기 클라이언트만 가져다 쓴다', () => {
  assert.doesNotMatch(lib, /\.(insert|update|upsert|delete|rpc)\(/)
  assert.doesNotMatch(lib, /from '@\/lib\/(market-items-server|market-purchase|credits)'/)
})

test('통계 API: 관리자 확인 뒤에 계정 권한으로 지표를 읽고, 가입 수 집계는 기존 것을 그대로 쓴다', () => {
  assert.ok(route.indexOf('profile?.is_admin') < route.indexOf('getAdminAccess()'))
  assert.match(route, /access \? getAdminDashboard\(access, period\) : null/)
  assert.match(route, /metrics: dashboard\?\.metrics \?\? null/)
  assert.equal(route.match(/const countSignups/g).length, 1)
  assert.doesNotMatch(lib, /from\('profiles'\)/)
})

test('화면 순서: 처리 대기 → 판매 상태·전송 상태 → 지표 → 최근 주문·문의', () => {
  // 대시보드 페이지의 접근 검사와 판매 상태 조회는 그대로다.
  assert.match(page, /await requireAdminPanelUser\(\)\s*const salesStatus = await getPaymentSalesStatus\(\)/)
  assert.match(page, /<DashboardClient salesPanel=\{<PaymentSalesPanel status=\{salesStatus\} \/>\} \/>/)

  const body = dashboard.slice(dashboard.lastIndexOf('기준: 한국 시간'))
  const positions = ['ADMIN_WORK_ITEMS.map(', '{salesPanel}', '관리자 알림 전송(슬랙)', 'aria-label="지표"', '최근 충전 주문', '최근 문의'].map((mark) => body.indexOf(mark))
  assert.ok(positions.every((position) => position >= 0))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  // 전송 상태는 알림 패널과 같은 값·같은 문구를 쓴다(따로 조회하지 않는다).
  assert.match(dashboard, /dispatchStatusMessages\(alerts\.summary\.dispatch\)/)
  assert.equal(dashboard.match(/fetch\(/g).length, 1)
})

test('화면: 권한 없는 구역은 그리지 않고, 못 센 값은 확인 불가, 테스트 주문 제외를 적는다', () => {
  assert.match(dashboard, /\{metrics \? \(/)
  assert.match(dashboard, /\{recentOrders \? \(/)
  assert.match(dashboard, /\{recentTickets \? \(/)
  assert.match(dashboard, /value == null \? '확인 불가'/)
  assert.match(dashboard, /테스트 환경 주문은 지표와 최근 주문에서 제외했습니다/)
  assert.match(dashboard, /뒤에 환불된 결제도 포함/)
  assert.match(dashboard, /환불·회수된 구매는 제외/)
  assert.match(dashboard, /불러오지 못했습니다/)
  assert.match(dashboard, /href=\{`\/admin\/support\?ticket=\$\{ticket\.id\}`\}/)
  assert.match(dashboard, /href=\{`\/admin\/orders\?q=\$\{encodeURIComponent\(order\.order_id\)\}`\}/)
  assert.match(dashboard, /href=\{`\/admin\/users\/\$\{order\.user_id\}`\}/)
  assert.match(dashboard, /href=\{`\/admin\/users\/\$\{ticket\.user_id\}`\}/)
  // 좁은 화면: 최근 목록은 표가 아니라 줄 목록이다.
  assert.doesNotMatch(dashboard, /<Table|<table/)
})
