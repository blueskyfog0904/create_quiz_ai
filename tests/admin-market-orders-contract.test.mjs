import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(admin)/admin/orders/page.tsx')
const client = read('src/app/(admin)/admin/orders/market-orders-client.tsx')
const route = read('src/app/api/admin/orders/market/route.ts')
const libSource = read('src/lib/admin-orders-server.ts')
// 같은 파일 앞쪽의 '충전 결제' 조회는 tests/admin-orders-contract.test.mjs가 본다.
const MARKET_PART_START = '// ───── 주문 조회 › 마켓 구매'
const lib = libSource.slice(libSource.indexOf(MARKET_PART_START))

test('마켓 구매 부분을 가르는 표식이 lib에 정확히 한 번 있다', () => {
  assert.equal(libSource.split(MARKET_PART_START).length - 1, 1)
})

const orders = load('src/lib/admin-orders.ts')
const diagnosis = load('src/lib/market-download-diagnosis.ts', {
  '@/lib/market-purchase': load('src/lib/market-purchase.ts', { '@/lib/market-items-server': {} }),
})

test('마켓 구매 탭: 같은 페이지의 두 번째 탭이고 route는 orders.view 가드를 쓴다', () => {
  assert.match(page, /\{ id: 'payments', label: '충전 결제' \},\s*\{ id: 'market', label: '마켓 구매' \},/)
  assert.match(page, /\{activeTab\.id === 'market' && <MarketOrdersClient \/>\}/)
  assert.match(route, /export async function GET\([^)]*\) \{\s*const guard = await requireAdminApiPermission\('orders\.view'\)\s*if \('error' in guard\) \{\s*return NextResponse\.json\(\{ error: guard\.error \}, \{ status: guard\.status \}\)/)
})

test('조회 전용: 쓰기와 GET 외 핸들러가 없고, 화면은 조회 API 하나만 부른다', () => {
  for (const source of [route, lib]) {
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete|rpc)\(/)
  }
  assert.doesNotMatch(client, /supabase|method:/)
  assert.deepEqual(client.match(/fetch\([^)]*\)/g), ['fetch(`/api/admin/orders/market?${requestKey}`)'])
  assert.deepEqual(route.match(/export async function (\w+)\(/g), ['export async function GET('])
  // 다운로드 route를 부르거나 다운로드 주소를 만들지 않는다(부르면 다운로드 기록이 생겨 환불 불가가 된다).
  assert.doesNotMatch(client + lib, /\/download|createSignedUrl|storage_path|storage_bucket/)
})

test('service role 클라이언트로 읽고, 관계마다 생성된 타입에 있는 FK 이름을 적는다', () => {
  assert.match(lib, /const supabase = createAdminClient\(\)/)
  assert.match(libSource, /import \{ createAdminClient \} from '@\/lib\/supabase\/bypass'/)
  for (const relation of [
    'user:profiles!market_purchase_orders_user_id_fkey(email, display_tag)',
    'item:market_items!market_purchase_orders_item_workspace_fkey(title, status, is_active, deleted_at)',
    'lines:market_purchase_lines!market_purchase_lines_order_workspace_fkey(',
    'subproduct:market_item_subproducts!market_purchase_lines_subproduct_workspace_fkey(title)',
    'bundle:market_item_bundle_options!market_purchase_lines_bundle_workspace_fkey(label)',
    'entitlements:market_entitlements!market_entitlements_order_workspace_fkey(id, item_id, scope, status, subproduct_id, file_id, source_order_id)',
    'refunds:market_refund_requests!market_refund_requests_order_id_fkey(',
    'subproduct:market_item_subproducts!market_subproduct_files_subproduct_workspace_fkey(title, is_active, deleted_at)',
    'file_type:market_file_types!market_subproduct_files_type_workspace_fkey(label)',
  ]) {
    assert.ok(lib.includes(relation), relation)
  }
  const types = read('src/types/supabase.ts')
  const fks = [...lib.matchAll(/!(\w+_fkey)\(/g)].map((match) => match[1])
  assert.equal(fks.length, 9)
  for (const fk of fks) assert.ok(types.includes(`foreignKeyName: "${fk}"`), fk)
})

test('개인정보: 회원은 email·display_tag만, 다운로드 기록은 시각·파일만 읽는다', () => {
  const profileSelects = [...lib.matchAll(/profiles(?:!\w+)?\(([^)]*)\)|from\('profiles'\)\.select\('([^']*)'\)/g)].map((match) => match[1] ?? match[2])
  assert.equal(profileSelects.length, 2)
  for (const columns of profileSelects) {
    for (const column of columns.split(',').map((name) => name.trim())) {
      assert.ok(['id', 'email', 'display_tag'].includes(column), column)
    }
  }
  assert.match(lib, /\.from\('market_download_events'\)\s*\.select\('id, order_id, subproduct_file_id, created_at'\)/)
  // 진단용 추가 조회도 회원 정보는 더 읽지 않는다(권한은 id들, 환불 대기는 주문 id만).
  assert.match(lib, /\.from\('market_entitlements'\)\s*\.select\('id, user_id, item_id, scope, status, subproduct_id, file_id, source_order_id'\)/)
  assert.match(lib, /\.from\('market_refund_requests'\)\s*\.select\('order_id, refund_kind, refund_subproduct_ids'\)\s*\.eq\('target_kind', 'v2_order'\)\s*\.eq\('status', 'pending'\)/)
  assert.doesNotMatch(lib, /phone|ip_address|user_agent|select\('\*'|\*,|eligibility_snapshot|credit_consumptions|idempotency_key|checksum/)
  assert.match(client, /formatMemberDisplayName\(order\.user\?\.email, order\.user\?\.display_tag\)/)
})

test('조회 실패는 0건과 구분해 오류로 보인다', () => {
  assert.match(route, /catch \(error\) \{[\s\S]*return NextResponse\.json\(\{ error: '주문을 불러오지 못했습니다\.[^']*' \}, \{ status: 500 \}\)/)
  assert.match(client, /if \(!response\.ok \|\| !result\?\.success\) throw new Error\(/)
  assert.match(client, /\{loadError && \(\s*<div role="alert"/)
  const loading = client.indexOf('{isLoading ? (')
  const failed = client.indexOf(') : !data ? (', loading)
  const empty = client.indexOf(') : data.orders.length === 0 ? (', failed)
  assert.ok(loading > 0 && failed > loading && empty > failed)
  assert.match(client, /data\?\.downloadsUnavailable \? \(\s*<p role="alert"/)
  assert.match(client, /data\?\.searchTruncated && \(/)
})

test('이름표는 DB가 허용하는 값을 모두 덮고, 사유는 한글로 보인다', () => {
  const schema = read('supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql')
  const allowed = (table, column) => {
    const block = schema.slice(schema.indexOf(`create table if not exists public.${table}`))
    return [...block.match(new RegExp(`${column} text not null[^\\n]*check \\(${column} in \\(([^)]*)\\)`))[1].matchAll(/'(\w+)'/g)].map((match) => match[1]).sort()
  }
  assert.deepEqual(Object.keys(orders.MARKET_ORDER_STATUS_LABELS).sort(), allowed('market_purchase_orders', 'status'))
  assert.deepEqual(Object.keys(orders.MARKET_PURCHASE_LINE_TYPE_LABELS).sort(), allowed('market_purchase_lines', 'line_type'))
  assert.deepEqual(Object.keys(orders.MARKET_ENTITLEMENT_SCOPE_LABELS).sort(), allowed('market_entitlements', 'scope'))
  assert.deepEqual(Object.keys(orders.MARKET_ENTITLEMENT_STATUS_LABELS).sort(), allowed('market_entitlements', 'status'))
  assert.match(read('supabase/migrations/20260602020000_add_market_refunds.sql'), /check \(status in \('pending', 'approved', 'rejected', 'canceled', 'failed'\)\)/)
  assert.deepEqual(Object.keys(orders.MARKET_REFUND_REQUEST_STATUS_LABELS), ['pending', 'approved', 'rejected', 'canceled', 'failed'])
  assert.deepEqual(Object.keys(orders.WORKSPACE_SUBJECT_LABELS).sort(), [...load('src/lib/workspace-subject.ts').WORKSPACE_SUBJECTS].sort())
  assert.match(client, /labelOf\(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, file\.diagnosis\.reason\)/)
})

test('검색 조건: 주문 id는 uuid일 때만, 맞는 것이 없으면 null', () => {
  const { buildMarketOrderSearchFilter } = orders
  const uuid = '44444444-4444-4444-8444-444444444444'
  assert.equal(buildMarketOrderSearchFilter(uuid, [], []), `id.eq.${uuid}`)
  assert.equal(buildMarketOrderSearchFilter('수능', ['u1'], ['i1', 'i2']), 'user_id.in.(u1),item_id.in.(i1,i2)')
  assert.equal(buildMarketOrderSearchFilter('a,b)"c', [], []), null)
  assert.equal(buildMarketOrderSearchFilter(`${uuid}) or (1=1`, [], []), null)
})

const ITEM = 'item-1'
const fileRow = (id, extra = {}) => ({
  id, item_id: ITEM, subproduct_id: 'sp-1', original_file_name: `${id}.pdf`, is_active: true, deleted_at: null,
  subproduct: { title: '문제', is_active: true, deleted_at: null }, file_type: { label: 'PDF' }, ...extra,
})
const orderRow = (index, extra = {}) => ({
  id: `o${index}`, workspace_subject: 'korean', user_id: 'u1', item_id: ITEM, status: 'completed', original_price_credits: 30, charged_credits: 30,
  created_at: '2026-11-10T00:00:00Z',
  user: { email: 'member@example.com', display_tag: 'AB12' },
  item: { title: '모의고사', status: 'published', is_active: true, deleted_at: null },
  lines: [{ id: `l${index}`, line_type: 'subproduct', price_credits: 30, status: 'completed', subproduct_id: 'sp-1', subproduct: { title: '문제' }, bundle: null }],
  entitlements: [{ id: `e${index}`, item_id: ITEM, scope: 'subproduct', status: 'active', subproduct_id: 'sp-1', file_id: null, source_order_id: `o${index}` }],
  refunds: [], ...extra,
})

// memberEntitlements를 주지 않으면 주문에 붙은 사용 가능 권한이 곧 회원의 권한 전부다(주문마다 회원이 다르다고 본다).
function loadMarketOrders({
  rows = [], matchedUsers = [], matchedItems = [], files = [], filesError = null, events = [], eventsError = null, countError = null,
  memberEntitlements = rows.flatMap((row) => row.entitlements.filter((entitlement) => entitlement.status === 'active').map((entitlement) => ({ ...entitlement, user_id: row.user_id }))),
  entitlementsError = null, pendingRefundOrderIds = [], pendingRefundsError = null, suspensions = [],
} = {}) {
  const queries = []
  const { client: admin } = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    if (table === 'market_purchase_orders') {
      if (op(ops, 'select')[2]?.head) return countError ? { count: null, error: { message: countError } } : { count: rows.length, error: null }
      const [, from, to] = op(ops, 'range')
      return { data: rows.slice(from, to + 1), error: null }
    }
    if (table === 'profiles') return { data: matchedUsers, error: null }
    if (table === 'market_items') return { data: matchedItems, error: null }
    if (table === 'market_subproduct_files') return filesError ? { data: null, error: { message: filesError } } : { data: files, error: null }
    if (table === 'market_entitlements') return entitlementsError ? { data: null, error: { message: entitlementsError } } : { data: memberEntitlements, error: null }
    if (table === 'market_refund_requests') {
      return pendingRefundsError
        ? { data: null, error: { message: pendingRefundsError } }
        : { data: pendingRefundOrderIds.filter((orderId) => op(ops, 'in')[2].includes(orderId)).map((order_id) => ({ order_id })), error: null }
    }
    if (table === 'market_download_events') return eventsError ? { data: null, error: { message: eventsError } } : { data: events, error: null }
    // 12번: 회원의 활성 정지(다운로드 route 와 같은 판정)
    if (table === 'member_suspensions') return { data: suspensions, error: null }
    throw new Error(`unexpected table ${table}`)
  })
  const server = load('src/lib/admin-orders-server.ts', {
    '@/lib/payment-orders-server': {},
    '@/lib/admin-accounts-shared': {},
    '@/lib/kst-period': load('src/lib/kst-period.ts'),
    '@/lib/list-pagination': load('src/lib/list-pagination.ts'),
    '@/lib/admin-orders': orders,
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/market-download-diagnosis': diagnosis,
    // 10번: 탈퇴 회원 표시(이 시험의 회원은 탈퇴하지 않음)
    '@/lib/withdrawn-member-redaction-server': { readWithdrawnUserIdsForRedaction: async () => new Set() },
  })
  return { server, queries }
}

test('목록: 건수를 먼저 세고 range로 읽으며, 상태·과목·기간이 두 쿼리에 같이 걸린다', async () => {
  const rows = Array.from({ length: 45 }, (_, index) => orderRow(index))
  const { server, queries } = loadMarketOrders({ rows, files: [fileRow('f1')] })
  const result = await server.listMarketOrdersForAdmin({ status: 'completed', subject: 'english', from: '2026-11-16', to: '2026-11-01', page: '9', pageSize: '20' })
  assert.deepEqual([result.totalCount, result.page, result.pageSize, result.totalPages, result.orders.length], [45, 3, 20, 3, 5])
  const orderQueries = queries.filter((query) => query.table === 'market_purchase_orders')
  assert.equal(orderQueries.length, 2)
  assert.equal(op(orderQueries[0].ops, 'select')[2].head, true)
  assert.deepEqual(op(orderQueries[1].ops, 'range'), ['range', 40, 59])
  for (const { ops } of orderQueries) {
    assert.deepEqual(ops.filter(([name]) => name === 'eq'), [['eq', 'status', 'completed'], ['eq', 'workspace_subject', 'english']])
    // 뒤바뀐 기간은 바로잡는다.
    assert.deepEqual(op(ops, 'gte'), ['gte', 'created_at', '2026-10-31T15:00:00.000Z'])
    assert.deepEqual(op(ops, 'lt'), ['lt', 'created_at', '2026-11-16T15:00:00.000Z'])
    assert.equal(op(ops, 'or'), undefined)
  }
  assert.deepEqual(orderQueries[1].ops.filter(([name]) => name === 'order'), [['order', 'created_at', { ascending: false }], ['order', 'id', { ascending: false }]])
  // 검색어가 없으면 회원·상품 선조회를 하지 않는다. 파일은 상품 id로, 다운로드 기록은 주문 id로 읽는다.
  assert.equal(queries.some((query) => query.table === 'profiles' || query.table === 'market_items'), false)
  assert.deepEqual(op(queries.find((query) => query.table === 'market_subproduct_files').ops, 'in'), ['in', 'item_id', [ITEM]])
  assert.deepEqual(op(queries.find((query) => query.table === 'market_download_events').ops, 'in'), ['in', 'order_id', ['o40', 'o41', 'o42', 'o43', 'o44']])
  // 권한은 주문이 아니라 회원·상품으로(사용 가능한 것만), 환불 대기는 그 권한들의 주문으로 읽는다
  // (이 가짜 DB에서는 45건이 모두 같은 회원·같은 상품이라 다른 쪽 주문의 권한까지 잡힌다).
  const entitlementOps = queries.find((query) => query.table === 'market_entitlements').ops
  assert.deepEqual(entitlementOps.filter(([name]) => name === 'in' || name === 'eq'), [['in', 'user_id', ['u1']], ['in', 'item_id', [ITEM]], ['eq', 'status', 'active']])
  const refundOps = queries.find((query) => query.table === 'market_refund_requests').ops
  assert.deepEqual(refundOps.filter(([name]) => name === 'in' || name === 'eq'), [['eq', 'target_kind', 'v2_order'], ['eq', 'status', 'pending'], ['in', 'order_id', rows.map((row) => row.id)]])
})

test('과목 기본값은 전체: 과목·상태 값이 이름표에 없으면 거르지 않는다', async () => {
  const { server, queries } = loadMarketOrders({ rows: [orderRow(1)] })
  await server.listMarketOrdersForAdmin({ subject: 'math', status: 'done' })
  for (const { ops } of queries.filter((query) => query.table === 'market_purchase_orders')) assert.equal(op(ops, 'eq'), undefined)
})

test('검색: 이메일·상품명 부분 일치를 먼저 찾아 조건에 넣고, 상한을 넘으면 알린다', async () => {
  const { server, queries } = loadMarketOrders({
    rows: [orderRow(1)],
    matchedUsers: [{ id: 'u1' }],
    matchedItems: Array.from({ length: 51 }, (_, index) => ({ id: `i${index}` })),
  })
  const result = await server.listMarketOrdersForAdmin({ q: '  50%_*off  ' })
  for (const table of ['profiles', 'market_items']) {
    const { ops } = queries.find((query) => query.table === table)
    assert.deepEqual(op(ops, 'select'), ['select', 'id'])
    assert.deepEqual(op(ops, 'ilike'), ['ilike', table === 'profiles' ? 'email' : 'title', '%50\\%\\_off%'])
    assert.deepEqual(op(ops, 'order'), ['order', 'id'])
    assert.deepEqual(op(ops, 'limit'), ['limit', 51])
  }
  const expected = `user_id.in.(u1),item_id.in.(${Array.from({ length: 50 }, (_, index) => `i${index}`).join(',')})`
  for (const { ops } of queries.filter((query) => query.table === 'market_purchase_orders')) assert.deepEqual(op(ops, 'or'), ['or', expected])
  assert.equal(result.searchTruncated, true)
})

test('검색어에 맞는 것이 없으면 주문을 읽지 않고 0건, 건수 조회 실패는 예외', async () => {
  const none = loadMarketOrders({ rows: [orderRow(1)] })
  const result = await none.server.listMarketOrdersForAdmin({ q: '없는검색어' })
  assert.deepEqual(result, { orders: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0, downloadsUnavailable: false, downloadsTruncated: false, searchTruncated: false })
  assert.equal(none.queries.some((query) => query.table === 'market_purchase_orders'), false)

  const empty = loadMarketOrders()
  assert.equal((await empty.server.listMarketOrdersForAdmin({})).totalCount, 0)
  assert.equal(empty.queries.length, 1)

  await assert.rejects(() => loadMarketOrders({ countError: 'boom' }).server.listMarketOrdersForAdmin({}), /boom/)
  // 파일·권한·환불 대기를 읽지 못하면 진단이 틀리게 나오므로 목록 전체가 오류다.
  await assert.rejects(() => loadMarketOrders({ rows: [orderRow(1)], filesError: 'denied' }).server.listMarketOrdersForAdmin({}), /denied/)
  await assert.rejects(() => loadMarketOrders({ rows: [orderRow(1)], entitlementsError: 'no-ent' }).server.listMarketOrdersForAdmin({}), /no-ent/)
  await assert.rejects(() => loadMarketOrders({ rows: [orderRow(1)], pendingRefundsError: 'no-refund' }).server.listMarketOrdersForAdmin({}), /no-refund/)
})

const summary = (fileCount, downloadableCount, reason, extra = {}) => (
  { fileCount, downloadableCount, reason, ownEntitlementReason: null, otherOrderIds: [], ...extra }
)

// 한 회원이 같은 상품을 두 번 산 경우: 주문 A(구성 1개 권한) 뒤 주문 B(묶음 → 상품 전체 권한)
function twoOrders({ bStatus = 'active', pendingRefundOrderIds = [] } = {}) {
  const entitlementA = { id: 'eA', item_id: ITEM, scope: 'subproduct', status: 'active', subproduct_id: 'sp-1', file_id: null, source_order_id: 'oA' }
  const entitlementB = { id: 'eB', item_id: ITEM, scope: 'item', status: bStatus, subproduct_id: null, file_id: null, source_order_id: 'oB' }
  return loadMarketOrders({
    rows: [
      orderRow('A', { entitlements: [entitlementA] }),
      orderRow('B', {
        status: bStatus === 'active' ? 'completed' : 'refunded',
        lines: [{ id: 'lB', line_type: 'bundle', price_credits: 50, status: 'completed', subproduct_id: null, subproduct: null, bundle: { label: '전체 묶음' } }],
        entitlements: [entitlementB],
      }),
    ],
    files: [fileRow('f1'), fileRow('f2', { subproduct_id: 'sp-2', subproduct: { title: '해설', is_active: true, deleted_at: null } })],
    pendingRefundOrderIds,
  }).server.listMarketOrdersForAdmin({})
}

test('같은 회원이 같은 상품에 권한을 2개 가지면, 주문이 아니라 회원이 실제로 받을 수 있는지로 판정한다', async () => {
  // 1·2) A 정상 + B 환불 대기: f1은 주문 A의 권한으로 받는다(route가 환불 심사 중이 아닌 주문의 권한을 쓴다). 두 주문 줄 모두 같은 답이다.
  const pendingB = await twoOrders({ pendingRefundOrderIds: ['oB'] })
  const [a1, b1] = pendingB.orders
  assert.deepEqual(a1.files.map((file) => [file.id, file.diagnosis.downloadable, file.diagnosis.entitlementOrderId]), [['f1', true, 'oA']])
  assert.deepEqual(a1.download, summary(1, 1, null))
  // 주문 B: f1은 주문 A의 권한으로 가능, f2는 B의 권한만 덮으므로 불가
  assert.deepEqual(b1.files.map((file) => [file.id, file.diagnosis.reason, file.diagnosis.entitlementOrderId]), [['f1', null, 'oA'], ['f2', 'pending_refund', null]])
  assert.deepEqual(b1.download, summary(2, 1, 'pending_refund', { otherOrderIds: ['oA'] }))

  // A 환불 대기 + B 정상: f1은 주문 B의 권한으로 받는다.
  const pendingA = await twoOrders({ pendingRefundOrderIds: ['oA'] })
  assert.deepEqual(pendingA.orders[0].download, summary(1, 1, null, { otherOrderIds: ['oB'] }))
  assert.deepEqual(pendingA.orders[1].download, summary(2, 2, null))

  // 3) A 정상 + B 환불 완료: 주문 B 줄에서도 f1은 주문 A의 권한으로 받을 수 있다고 나오고, 이 주문 자체의 권한은 회수됐다고 따로 알린다.
  const refundedB = await twoOrders({ bStatus: 'refunded' })
  const [a3, b3] = refundedB.orders
  assert.deepEqual(a3.download, summary(1, 1, null))
  assert.deepEqual(b3.files.map((file) => [file.id, file.diagnosis.downloadable, file.diagnosis.reason]), [['f1', true, null], ['f2', false, 'entitlement_refunded']])
  assert.deepEqual(b3.download, summary(2, 1, 'entitlement_refunded', { ownEntitlementReason: 'entitlement_refunded', otherOrderIds: ['oA'] }))

  // 둘 다 정상이면 겹치는 f1은 더 좁은 범위인 주문 A의 권한으로, f2는 주문 B의 권한으로 받는다.
  const both = await twoOrders()
  assert.deepEqual(both.orders.map((order) => [order.download.downloadableCount, order.download.fileCount, order.download.otherOrderIds]), [[1, 1, []], [2, 2, ['oA']]])

  // 다른 회원의 권한은 섞이지 않는다.
  const other = await loadMarketOrders({
    rows: [orderRow(1, { entitlements: [] })],
    files: [fileRow('f1')],
    memberEntitlements: [{ id: 'eX', user_id: 'someone-else', item_id: ITEM, scope: 'item', status: 'active', subproduct_id: null, file_id: null, source_order_id: 'oX' }],
  }).server.listMarketOrdersForAdmin({})
  assert.deepEqual(other.orders[0].download, summary(1, 0, 'no_entitlement', { ownEntitlementReason: 'no_entitlement' }))
})

test('화면은 회원이 받을 수 있는지와 이 주문의 권한 상태를 따로 보여 준다', () => {
  assert.doesNotMatch(client + lib, /uncertain|확인 필요/)
  assert.match(client, /회원 다운로드 불가: \{reason\}/)
  assert.match(client, /회원 다운로드 가능 \(파일 \{download\.fileCount\}개\)/)
  assert.match(client, /const own = `이 주문: \$\{labelOf\(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, download\.ownEntitlementReason\)\}`/)
  assert.match(client, /같은 회원의 다른 주문\(\$\{download\.otherOrderIds\.map\(\(orderId\) => orderId\.slice\(0, 8\)\)\.join\(', '\)\}\) 권한으로 다운로드/)
  assert.equal(client.match(/ownEntitlementNote\((order|selectedOrder)\.download\) &&/g).length, 2)
})

test('주문마다 파일별 진단·요약·다운로드 기록을 붙인다', async () => {
  const files = [
    fileRow('f1'),
    fileRow('f-old', { is_active: false, deleted_at: '2026-11-01T00:00:00Z' }),
    fileRow('f-other', { subproduct_id: 'sp-2', subproduct: { title: '해설', is_active: true, deleted_at: null } }),
  ]
  const rows = [
    orderRow(1),
    // 환불 대기 중
    orderRow(2, { user_id: 'u2', refunds: [{ id: 'r1', status: 'pending', requested_refund_credits: 30, approved_refund_credits: null, reason: '잘못 구매', admin_note: null, created_at: '2026-11-11T00:00:00Z', processed_at: null }] }),
    // 환불되어 권한이 회수됨
    orderRow(3, { user_id: 'u3', status: 'refunded', entitlements: [{ id: 'e3', item_id: ITEM, scope: 'subproduct', status: 'refunded', subproduct_id: 'sp-1', file_id: null, source_order_id: 'o3' }] }),
    // 구매했는데 권한 행이 없는 이상 상태 → 구매 줄로 파일을 찾아 진단
    orderRow(4, { user_id: 'u4', entitlements: [] }),
    // 숨김 상품의 묶음 구매(상품 전체 권한)
    orderRow(5, {
      user_id: 'u5',
      item: { title: '모의고사', status: 'hidden', is_active: true, deleted_at: null },
      lines: [{ id: 'l5', line_type: 'bundle', price_credits: 50, status: 'completed', subproduct_id: null, subproduct: null, bundle: { label: '전체 묶음' } }],
      entitlements: [{ id: 'e5', item_id: ITEM, scope: 'item', status: 'active', subproduct_id: null, file_id: null, source_order_id: 'o5' }],
    }),
    // 삭제된 상품
    orderRow(6, { user_id: 'u6', item: { title: '모의고사', status: 'published', is_active: true, deleted_at: '2026-11-12T00:00:00Z' } }),
  ]
  const events = [
    { id: 'd2', order_id: 'o1', subproduct_file_id: 'f1', created_at: '2026-11-12T00:00:00Z' },
    { id: 'd1', order_id: 'o1', subproduct_file_id: 'gone', created_at: '2026-11-11T00:00:00Z' },
  ]
  const { server } = loadMarketOrders({ rows, files, events, pendingRefundOrderIds: ['o2'] })
  const result = await server.listMarketOrdersForAdmin({})
  const [normal, pending, refunded, noEntitlement, hiddenBundle, deletedItem] = result.orders

  // 정상: 자기 구성의 파일만(다른 구성 파일 제외), 내려간 옛 파일은 목록에 있지만 요약에서 뺀다.
  assert.deepEqual(normal.files.map((file) => [file.id, file.removed, file.diagnosis.reason]), [['f1', false, null], ['f-old', true, 'file_deleted']])
  assert.deepEqual(normal.download, summary(1, 1, null))
  assert.deepEqual(normal.downloads, {
    count: 2, latestAt: '2026-11-12T00:00:00Z',
    recent: [{ id: 'd2', createdAt: '2026-11-12T00:00:00Z', fileName: 'f1.pdf' }, { id: 'd1', createdAt: '2026-11-11T00:00:00Z', fileName: null }],
  })
  assert.deepEqual(normal.lines, [{ id: 'l1', lineType: 'subproduct', priceCredits: 30, status: 'completed', title: '문제' }])
  assert.deepEqual(normal.entitlements, [{ id: 'e1', scope: 'subproduct', status: 'active', target: '문제' }])
  assert.deepEqual(normal.user, { email: 'member@example.com', display_tag: 'AB12' })

  assert.deepEqual(pending.download, summary(1, 0, 'pending_refund'))
  assert.equal(pending.refunds[0].reason, '잘못 구매')
  assert.deepEqual(refunded.download, summary(1, 0, 'entitlement_refunded', { ownEntitlementReason: 'entitlement_refunded' }))
  assert.deepEqual(noEntitlement.download, summary(1, 0, 'no_entitlement', { ownEntitlementReason: 'no_entitlement' }))
  assert.deepEqual(noEntitlement.files.map((file) => file.id), ['f1', 'f-old'])
  // 숨김 상품이어도 구매자는 받을 수 있고, 상품 전체 권한은 모든 구성의 파일을 덮는다.
  assert.deepEqual(hiddenBundle.files.map((file) => file.id), ['f1', 'f-old', 'f-other'])
  assert.deepEqual(hiddenBundle.download, summary(2, 2, null))
  assert.equal(hiddenBundle.lines[0].title, '전체 묶음')
  assert.deepEqual(deletedItem.download, summary(1, 0, 'item_deleted'))
  assert.deepEqual(pending.downloads, { count: 0, latestAt: null, recent: [] })
  assert.deepEqual([result.downloadsUnavailable, result.downloadsTruncated], [false, false])
})

test('파일이 하나도 없는 주문은 사유를 알리고, 다운로드 기록 실패·상한 초과는 표시만 남긴다', async () => {
  const noFiles = await loadMarketOrders({ rows: [orderRow(1)] }).server.listMarketOrdersForAdmin({})
  assert.deepEqual(noFiles.orders[0].download, summary(0, 0, 'file_missing'))
  // 파일이 없는 환불 완료 주문은 '파일 없음'이 아니라 권한 사유를 알린다. 파일이 없는 구성의 권한 대상 이름은 구매 줄에서 찾는다.
  const refundedNoFiles = await loadMarketOrders({
    rows: [orderRow(1, { status: 'refunded', entitlements: [{ id: 'e1', item_id: ITEM, scope: 'subproduct', status: 'refunded', subproduct_id: 'sp-1', file_id: null, source_order_id: 'o1' }] })],
  }).server.listMarketOrdersForAdmin({})
  assert.deepEqual(refundedNoFiles.orders[0].download, summary(0, 0, 'entitlement_refunded', { ownEntitlementReason: 'entitlement_refunded' }))
  assert.deepEqual(refundedNoFiles.orders[0].entitlements, [{ id: 'e1', scope: 'subproduct', status: 'refunded', target: '문제' }])
  const onlyRemoved = await loadMarketOrders({ rows: [orderRow(1)], files: [fileRow('f-old', { is_active: false })] }).server.listMarketOrdersForAdmin({})
  assert.deepEqual(onlyRemoved.orders[0].download, summary(0, 0, 'file_inactive'))

  const failed = await loadMarketOrders({ rows: [orderRow(1)], files: [fileRow('f1')], eventsError: 'denied' }).server.listMarketOrdersForAdmin({})
  assert.equal(failed.orders.length, 1)
  assert.deepEqual([failed.downloadsUnavailable, failed.downloadsTruncated], [true, false])

  const events = Array.from({ length: 501 }, (_, index) => ({ id: `d${index}`, order_id: 'o1', subproduct_file_id: 'f1', created_at: '2026-11-12T00:00:00Z' }))
  const many = await loadMarketOrders({ rows: [orderRow(1)], files: [fileRow('f1')], events }).server.listMarketOrdersForAdmin({})
  assert.deepEqual([many.downloadsTruncated, many.orders[0].downloads.count, many.orders[0].downloads.recent.length], [true, 500, 20])
})

test('12번: 다운로드도 막은 활성 정지 회원의 파일은 member_suspended 로 진단한다(다운로드를 막지 않은 정지는 그대로)', async () => {
  const blocked = await loadMarketOrders({ rows: [orderRow(1)], files: [fileRow('f1')], suspensions: [{ user_id: 'u1', blocks_download: true }] })
    .server.listMarketOrdersForAdmin({})
  assert.deepEqual(blocked.orders[0].files.map((file) => [file.id, file.diagnosis.reason]), [['f1', 'member_suspended']])
  const open = await loadMarketOrders({ rows: [orderRow(1)], files: [fileRow('f1')], suspensions: [{ user_id: 'u1', blocks_download: false }] })
    .server.listMarketOrdersForAdmin({})
  assert.deepEqual(open.orders[0].files.map((file) => [file.id, file.diagnosis.downloadable]), [['f1', true]])
})
