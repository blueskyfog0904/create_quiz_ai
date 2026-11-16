import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(admin)/admin/orders/page.tsx')
const client = read('src/app/(admin)/admin/orders/orders-client.tsx')
const route = read('src/app/api/admin/orders/payments/route.ts')
const lib = read('src/lib/admin-orders-server.ts')

const orders = load('src/lib/admin-orders.ts')
const kstPeriod = load('src/lib/kst-period.ts')
const listPagination = load('src/lib/list-pagination.ts')

test('페이지와 route는 orders.view 권한 가드를 쓴다(지역 is_admin 검사 없음)', () => {
  assert.match(page, /export default async function AdminOrdersPage\([^)]*\) \{\s*await requireAdminPagePermission\('orders\.view'\)/)
  assert.match(route, /export async function GET\([^)]*\) \{\s*const guard = await requireAdminApiPermission\('orders\.view'\)\s*if \('error' in guard\) \{\s*return NextResponse\.json\(\{ error: guard\.error \}, \{ status: guard\.status \}\)/)
  for (const source of [page, route]) {
    assert.doesNotMatch(source, /\.select\('is_admin'\)|requireAdmin\(\)/)
  }
  assert.match(page, /<AdminMenuName href="\/admin\/orders" fallback="주문 조회" \/>/)
  assert.match(page, /buildAdminMenuMetadata\(\{\s*href: '\/admin\/orders',/)
})

test('조회 전용: 쓰기(insert·update·upsert·delete·rpc)와 GET 외 핸들러가 없다', () => {
  for (const source of [page, route, lib]) {
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete|rpc)\(/)
  }
  // 화면은 DB 클라이언트를 쓰지 않고(주소를 바꾸는 listQuery.update만 있다) 조회 API 하나만 GET으로 부른다.
  assert.doesNotMatch(client, /supabase|method:/)
  assert.deepEqual(client.match(/fetch\([^)]*\)/g), ['fetch(`/api/admin/orders/payments?${requestKey}`)'])
  assert.deepEqual(route.match(/export async function (\w+)\(/g), ['export async function GET('])
})

test('결제 표는 service role 결제 클라이언트로 읽고, 관계마다 FK 이름을 적는다', () => {
  assert.match(lib, /const supabase = createPaymentAdminClient\(\)/)
  assert.doesNotMatch(lib, /supabase\/server|supabase\/bypass/)
  for (const relation of [
    'user:profiles!payment_orders_user_id_fkey(email, display_tag)',
    'method:payment_methods!payment_orders_payment_method_fkey(label)',
    'transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(',
    'source:credit_sources!payment_orders_source_id_fkey(id, initial_credits, remaining_credits, status, expires_at)',
    'refunds:refund_requests!refund_requests_payment_order_id_fkey(id, status, origin, refund_amount, created_at, processed_at)',
  ]) {
    assert.ok(lib.includes(relation), relation)
  }
  // 적어 둔 FK 이름이 생성된 타입의 관계 이름과 맞는다.
  const types = read('src/types/supabase.ts')
  for (const [, fk] of lib.matchAll(/!(\w+_fkey)\(/g)) {
    assert.ok(types.includes(`foreignKeyName: "${fk}"`), fk)
  }
})

test('개인정보: 회원은 email·display_tag만 읽고, 결제사 원문·와일드카드 조회가 없다', () => {
  const profileSelects = [...lib.matchAll(/profiles(?:!\w+)?\(([^)]*)\)|from\('profiles'\)\.select\('([^']*)'\)/g)].map((match) => match[1] ?? match[2])
  assert.equal(profileSelects.length, 3)
  for (const columns of profileSelects) {
    for (const column of columns.split(',').map((name) => name.trim())) {
      assert.ok(['id', 'email', 'display_tag'].includes(column), column)
    }
  }
  assert.doesNotMatch(lib, /phone|address|birth|select\('\*'|\*,|raw_|payload|before_state|after_state|details/)
  assert.match(client, /formatMemberDisplayName\(order\.user\?\.email, order\.user\?\.display_tag\)/)
})

test('조회 실패는 0건과 구분해 오류로 보인다', () => {
  assert.match(route, /catch \(error\) \{[\s\S]*return NextResponse\.json\(\{ error: '주문을 불러오지 못했습니다\.[^']*' \}, \{ status: 500 \}\)/)
  assert.match(client, /if \(!response\.ok \|\| !result\?\.success\) throw new Error\(/)
  assert.match(client, /setLoaded\(\{ key: requestKey, data: null, error: /)
  assert.match(client, /\{loadError && \(\s*<div role="alert"/)
  // 표 본문: 불러오는 중 → 실패(data 없음) → 0건 순서로 가른다.
  const loading = client.indexOf('{isLoading ? (')
  const failed = client.indexOf(') : !data ? (', loading)
  const empty = client.indexOf(') : data.orders.length === 0 ? (', failed)
  assert.ok(loading > 0 && failed > loading && empty > failed)
  assert.match(client, /data\?\.actionsUnavailable \? \(\s*<p role="alert"/)
})

test('사이드바 기본 목록에 주문 조회가 환불 관리 다음에 있다', () => {
  const sidebar = load('src/lib/admin-sidebar.ts', { 'lucide-react': new Proxy({}, { get: () => () => null }) })
  const items = sidebar.DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items
  assert.equal(items[items.indexOf('/admin/refunds') + 1], '/admin/orders')
  const resolved = sidebar.resolveAdminSidebarMenuItems('korean', null)
  assert.equal(resolved.find((item) => item.href === '/admin/orders').name, '주문 조회')
  assert.equal(resolved.length, items.length)
})

test('필터 값은 이름표에 있는 값만 받는다', () => {
  const { normalizeOrderFilter, PAYMENT_ORDER_STATUS_LABELS, PAYMENT_PROVIDER_LABELS, PAYMENT_ENVIRONMENT_LABELS, labelOf } = orders
  assert.equal(normalizeOrderFilter(PAYMENT_ORDER_STATUS_LABELS, 'completed'), 'completed')
  assert.equal(normalizeOrderFilter(PAYMENT_ORDER_STATUS_LABELS, 'done'), 'all')
  assert.equal(normalizeOrderFilter(PAYMENT_ORDER_STATUS_LABELS, 'toString'), 'all')
  assert.equal(normalizeOrderFilter(PAYMENT_PROVIDER_LABELS, 'payapp'), 'payapp')
  assert.equal(normalizeOrderFilter(PAYMENT_PROVIDER_LABELS, null), 'all')
  assert.equal(normalizeOrderFilter(PAYMENT_ENVIRONMENT_LABELS, 'test'), 'test')
  assert.equal(normalizeOrderFilter(PAYMENT_ENVIRONMENT_LABELS, ''), 'all')
  // 주문 상태 이름표는 결제 주문 상태 타입의 값을 모두 담는다.
  const statusType = read('src/lib/payment-orders-server.ts').match(/export type PaymentOrderStatus =([\s\S]*?)\n\n/)[1]
  assert.deepEqual(Object.keys(PAYMENT_ORDER_STATUS_LABELS).sort(), [...statusType.matchAll(/'(\w+)'/g)].map((match) => match[1]).sort())
  assert.equal(labelOf(PAYMENT_ORDER_STATUS_LABELS, 'manual_review'), '수동 확인 필요')
  assert.equal(labelOf(PAYMENT_ORDER_STATUS_LABELS, 'new_status'), 'new_status')
  assert.equal(labelOf(PAYMENT_ORDER_STATUS_LABELS, null), '-')
})

test('검색 조건: 주문번호 정확 일치에 회원·거래번호로 찾은 주문을 더한다', () => {
  const { buildPaymentOrderSearchFilter, escapeIlike } = orders
  assert.equal(buildPaymentOrderSearchFilter('ORD-1', [], []), 'order_id.eq."ORD-1"')
  assert.equal(
    buildPaymentOrderSearchFilter('abc', ['u1', 'u2'], ['o1']),
    'order_id.eq."abc",user_id.in.(u1,u2),id.in.(o1)'
  )
  // 쉼표·괄호·따옴표가 or() 조건을 깨지 않는다.
  assert.equal(buildPaymentOrderSearchFilter('a,b)"c', [], []), 'order_id.eq."a,b)\\"c"')
  assert.equal(escapeIlike('a%b_c\\d'), 'a\\%b\\_c\\\\d')
})

test('기간 경계: 한국 날짜의 시작 시각(UTC)', () => {
  assert.equal(kstPeriod.getKstDateStart('2026-11-16'), '2026-11-15T15:00:00.000Z')
  assert.equal(kstPeriod.getKstDateStart('2026-11-16', 1), '2026-11-16T15:00:00.000Z')
  assert.equal(kstPeriod.getKstDateStart('2026-12-31', 1), '2026-12-31T15:00:00.000Z')
  for (const invalid of ['', null, undefined, '2026-02-30', '2026-13-01', '2026-1-1', '20261116', "2026-11-16' or 1=1"]) {
    assert.equal(kstPeriod.getKstDateStart(invalid), null, String(invalid))
  }
})

const orderRow = (index, extra = {}) => ({
  id: `o${index}`, order_id: `ORD-${index}`, provider: 'payapp', environment: 'live', status: 'completed',
  plan_name_snapshot: '기본', expected_amount: 10000, expected_credits: 100, failure_code: null, failure_message: null,
  created_at: '2026-11-10T00:00:00Z', approved_at: null, fulfilled_at: null, canceled_at: null,
  user: { email: 'member@example.com', display_tag: 'AB12' }, method: { label: '신용카드' },
  transaction: null, source: null, refunds: [], ...extra,
})

function loadOrders({ rows = [], matchedUsers = [], matchedTransactions = [], actions = [], actionsError = null, actors = [], countError = null } = {}) {
  const queries = []
  const { client: admin } = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    if (table === 'payment_orders') {
      if (op(ops, 'select')[2]?.head) return countError ? { count: null, error: { message: countError } } : { count: rows.length, error: null }
      const [, from, to] = op(ops, 'range')
      return { data: rows.slice(from, to + 1), error: null }
    }
    if (table === 'profiles') return { data: op(ops, 'ilike') ? matchedUsers : actors, error: null }
    if (table === 'payment_provider_transactions') return { data: matchedTransactions, error: null }
    if (table === 'payment_admin_actions') return actionsError ? { data: null, error: { message: actionsError } } : { data: actions, error: null }
    throw new Error(`unexpected table ${table}`)
  })
  const server = load('src/lib/admin-orders-server.ts', {
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => admin },
    '@/lib/admin-accounts-shared': load('src/lib/admin-accounts-shared.ts'),
    '@/lib/kst-period': kstPeriod,
    '@/lib/list-pagination': listPagination,
    '@/lib/admin-orders': orders,
  })
  return { server, queries }
}

test('목록: 건수를 먼저 세고 range로 읽으며, 필터·기간이 두 쿼리에 같이 걸린다', async () => {
  const rows = Array.from({ length: 45 }, (_, index) => orderRow(index))
  const { server, queries } = loadOrders({ rows })
  const result = await server.listPaymentOrdersForAdmin({
    provider: 'payapp', status: 'completed', environment: 'live', from: '2026-11-01', to: '2026-11-16', page: '9', pageSize: '20',
  })
  // 총 45건·20개씩 → 3쪽이 끝. 9쪽 요청은 3쪽으로 맞춘다.
  assert.deepEqual([result.totalCount, result.page, result.pageSize, result.totalPages, result.orders.length], [45, 3, 20, 3, 5])
  const orderQueries = queries.filter((query) => query.table === 'payment_orders')
  assert.equal(orderQueries.length, 2)
  assert.equal(op(orderQueries[0].ops, 'select')[2].head, true)
  assert.deepEqual(op(orderQueries[1].ops, 'range'), ['range', 40, 59])
  for (const { ops } of orderQueries) {
    assert.deepEqual(ops.filter(([name]) => name === 'eq'), [['eq', 'provider', 'payapp'], ['eq', 'status', 'completed'], ['eq', 'environment', 'live']])
    assert.deepEqual(op(ops, 'gte'), ['gte', 'created_at', '2026-10-31T15:00:00.000Z'])
    assert.deepEqual(op(ops, 'lt'), ['lt', 'created_at', '2026-11-16T15:00:00.000Z'])
    assert.equal(op(ops, 'or'), undefined)
  }
  assert.deepEqual(orderQueries[1].ops.filter(([name]) => name === 'order'), [['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }]])
  // 검색어가 없으면 회원·거래 선조회를 하지 않는다.
  assert.equal(queries.some((query) => query.table === 'payment_provider_transactions'), false)
})

test('검색: 이메일 부분 일치(와일드카드 이스케이프)·거래번호 정확 일치를 먼저 찾아 조건에 넣는다', async () => {
  const { server, queries } = loadOrders({
    rows: [orderRow(1)],
    matchedUsers: [{ id: 'u1' }],
    matchedTransactions: [{ payment_order_id: 'o1' }],
  })
  await server.listPaymentOrdersForAdmin({ q: '  50%_off  ', status: 'nope' })
  const profiles = queries.find((query) => query.table === 'profiles')
  assert.deepEqual(op(profiles.ops, 'select'), ['select', 'id'])
  assert.deepEqual(op(profiles.ops, 'ilike'), ['ilike', 'email', '%50\\%\\_off%'])
  const transactions = queries.find((query) => query.table === 'payment_provider_transactions')
  assert.deepEqual(op(transactions.ops, 'eq'), ['eq', 'provider_transaction_id', '50%_off'])
  for (const { ops } of queries.filter((query) => query.table === 'payment_orders')) {
    assert.deepEqual(op(ops, 'or'), ['or', 'order_id.eq."50%_off",user_id.in.(u1),id.in.(o1)'])
    // 이름표에 없는 상태 값은 필터로 쓰지 않는다.
    assert.equal(op(ops, 'eq'), undefined)
  }
})

test('0건이면 목록·조치 기록을 읽지 않고, 건수 조회 실패는 예외로 올린다', async () => {
  const empty = loadOrders()
  const result = await empty.server.listPaymentOrdersForAdmin({})
  assert.deepEqual(result, { orders: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0, actionsUnavailable: false, searchTruncated: false })
  assert.equal(empty.queries.length, 1)

  const failed = loadOrders({ countError: 'boom' })
  await assert.rejects(() => failed.server.listPaymentOrdersForAdmin({}), /boom/)
})

test('관리자 조치 기록은 주문 id로 따로 읽어 주문에 붙이고, 실패하면 표시만 남긴다', async () => {
  const rows = [orderRow(1), orderRow(2)]
  const action = {
    id: 'a1', actor_id: 'admin-1', action: 'paid_confirmed', payment_order_id: 'o2', note: '입금 확인',
    external_method: null, recovered_credits: null, unrecovered_credits: null, created_at: '2026-11-11T00:00:00Z',
  }
  const { server, queries } = loadOrders({ rows, actions: [action], actors: [{ id: 'admin-1', email: 'owner@example.com' }] })
  const result = await server.listPaymentOrdersForAdmin({})
  const actionQuery = queries.find((query) => query.table === 'payment_admin_actions')
  assert.deepEqual(op(actionQuery.ops, 'in'), ['in', 'payment_order_id', ['o1', 'o2']])
  assert.deepEqual(result.orders.map((order) => order.actions.length), [0, 1])
  assert.deepEqual(result.orders[1].actions[0], {
    id: 'a1', action: 'paid_confirmed', note: '입금 확인', externalMethod: null, recoveredCredits: null, unrecoveredCredits: null,
    createdAt: '2026-11-11T00:00:00Z', actor: 'owner@example.com',
  })
  assert.equal(result.actionsUnavailable, false)
  assert.deepEqual(result.orders[0].user, { email: 'member@example.com', display_tag: 'AB12' })
  assert.equal(result.orders[0].methodLabel, '신용카드')

  const failed = loadOrders({ rows, actionsError: 'denied' })
  const failedResult = await failed.server.listPaymentOrdersForAdmin({})
  assert.equal(failedResult.orders.length, 2)
  assert.equal(failedResult.actionsUnavailable, true)
})

test('이메일 검색: 상한을 넘으면 알리고, 쪽마다 같은 회원을 잡고, *를 와일드카드로 쓰지 않는다', () => {
  const lib = readFileSync(new URL('../src/lib/admin-orders-server.ts', import.meta.url), 'utf8')
  assert.match(lib, /const emailKeyword = query\.replaceAll\('\*', ''\)/)
  assert.match(lib, /\.ilike\('email', `%\$\{escapeIlike\(emailKeyword\)\}%`\)\.order\('id'\)\.limit\(SEARCH_MATCH_LIMIT \+ 1\)/)
  assert.match(lib, /searchTruncated = matchedUsers\.length > SEARCH_MATCH_LIMIT/)
  assert.match(lib, /matchedUsers\.slice\(0, SEARCH_MATCH_LIMIT\)/)
  // 0건일 때도, 목록이 있을 때도 결과에 싣는다.
  assert.equal(lib.match(/searchTruncated,?\s*\}/g)?.length ?? 0, 2)
  const client = readFileSync(new URL('../src/app/(admin)/admin/orders/orders-client.tsx', import.meta.url), 'utf8')
  assert.match(client, /data\?\.searchTruncated && \(/)
})

test('기간이 뒤바뀌어 들어오면 바로잡고, 조치 이름표는 DB가 허용하는 조치를 모두 덮는다', () => {
  const lib = readFileSync(new URL('../src/lib/admin-orders-server.ts', import.meta.url), 'utf8')
  assert.match(lib, /input\.from && input\.to && input\.from > input\.to \? \[input\.to, input\.from\] : \[input\.from, input\.to\]/)
  const labels = readFileSync(new URL('../src/lib/admin-orders.ts', import.meta.url), 'utf8')
  const block = labels.slice(labels.indexOf('PAYMENT_ADMIN_ACTION_LABELS'), labels.indexOf('PAYMENT_EXTERNAL_METHOD_LABELS'))
  for (const action of ['paid_confirmed', 'unpaid_confirmed', 'cancel_handled', 'manual_refund_completed', 'manual_review_refund_rejected', 'alert_resolved']) {
    assert.ok(block.includes(`${action}:`), action)
  }
})
