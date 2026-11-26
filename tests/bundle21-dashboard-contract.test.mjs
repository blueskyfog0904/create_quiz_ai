import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { NextResponse, adminGuardMocks, load } from './helpers/market-images-harness.mjs'
import {
  NOW, fields, fullRpc, loadDashboardServer, marketDaily, owner, permissions, resolve, staff,
} from './helpers/admin-dashboard-harness.mjs'
import { buildRehearsalFiles, LIGHT_FORBIDDEN, NOVEMBER_EXAMPLE } from '../supabase/scripts/bundle21_rehearsal/generate.mjs'

// 21번 묶음 계약 시험(계획 docs/plan-bundle21-dashboard.md 9절): 권한별 허용 필드·함수 호출 조건·실패 격리·데이터 읽는 길·리허설.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const server = read('src/lib/admin-dashboard-server.ts')
const client = read('src/app/(admin)/admin/dashboard-client.tsx')
const charts = read('src/app/(admin)/admin/dashboard-charts.tsx')
const page = read('src/app/(admin)/admin/page.tsx')
const statsRoute = read('src/app/api/admin/stats/route.ts')
const recentRoute = read('src/app/api/admin/stats/recent/route.ts')
const migration = read('supabase/migrations/20261223100000_bundle21_dashboard_reports.sql')
const down = read('supabase/rollback/20261223100000_bundle21_dashboard_reports_down.sql')
const contentScript = read('supabase/scripts/20261223_bundle21_dashboard_content.sql')

const productRows = [
  { id: 'p1', title: '공개', workspace_subject: 'korean', status: 'published', is_active: true, deleted_at: null, draft_source: 'manual', updated_at: '2026-11-25T00:00:00Z' },
  { id: 'p2', title: '숨김(내림)', workspace_subject: 'korean', status: 'published', is_active: false, deleted_at: null, draft_source: 'manual', updated_at: '2026-11-24T00:00:00Z' },
  { id: 'p3', title: '숨김', workspace_subject: 'english', status: 'hidden', is_active: true, deleted_at: null, draft_source: 'manual', updated_at: '2026-11-23T00:00:00Z' },
  { id: 'p4', title: '임시', workspace_subject: 'korean', status: 'draft', is_active: true, deleted_at: null, draft_source: 'manual', updated_at: '2026-11-22T00:00:00Z' },
  { id: 'p5', title: '자동 업로드', workspace_subject: 'korean', status: 'draft', is_active: true, deleted_at: null, draft_source: 'auto_upload', updated_at: '2026-11-26T00:00:00Z' },
  { id: 'p6', title: '삭제', workspace_subject: 'korean', status: 'published', is_active: true, deleted_at: '2026-11-01T00:00:00Z', draft_source: 'manual', updated_at: '2026-11-26T01:00:00Z' },
  { id: 'p7', title: '보관', workspace_subject: 'english', status: 'archived', is_active: true, deleted_at: null, draft_source: null, updated_at: '2026-11-21T00:00:00Z' },
]

async function readDashboard(access, options = {}) {
  const loaded = loadDashboardServer({ rpc: fullRpc(), tables: { market_items: productRows }, ...options })
  const data = await loaded.server.getAdminDashboard(access, resolve(), { includeProducts: true })
  return { ...loaded, data }
}

// 응답 안의 모든 키(동적 키 아래도 포함)
function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, keys)
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { keys.add(key); collectKeys(child, keys) }
  return keys
}

test('orders.view 만: 원·C 필드(순 충전 매출·자료 판매 C·도넛·순위 C·요금제별)가 없고 report_charge_daily 를 부르지 않는다', async () => {
  const { data, calls } = await readDashboard(staff('orders.view'))
  assert.equal(data.charge, null)
  assert.equal(calls.rpc.some((call) => call.name === 'report_charge_daily'), false)
  const keys = collectKeys({ ...data, charge: undefined })
  for (const key of ['c', 'chargedCredits', 'byPlan', 'paymentAmount', 'net']) assert.equal(keys.has(key), false, key)
  // jsonb 안쪽(purchases·refunds 의 각 칸)에도 c 가 없다
  for (const row of [...data.market.data.days, ...data.market.data.previous]) {
    for (const kinds of Object.values(row.purchases)) for (const cell of Object.values(kinds)) assert.deepEqual(Object.keys(cell), ['n'])
    for (const cell of Object.values(row.refunds)) assert.deepEqual(Object.keys(cell), ['n'])
  }
  assert.equal(data.orderRanking.data[0].chargedCredits, undefined)
  assert.equal(data.orderRanking.data[0].orderCount, 3)
})

test('응답 필드는 4-1 허용 목록 밖에 없다(권한 조합 5가지)', async () => {
  const base = ['generatedAt', 'charge', 'market', 'activity', 'orderRanking', 'downloadRanking', 'products', 'failed', 'data']
  const marketKeys = ['days', 'previous', 'day', 'purchases', 'refunds', 'korean', 'english', 'subproduct', 'bundle', 'n']
  const activityKeys = ['days', 'day', 'totals', 'previousTotals']
  const rankKeys = ['itemId', 'title', 'subject', 'status', 'isActive', 'isDeleted', 'orderCount', 'downloadUsers', 'downloadCount']
  const productKeys = ['counts', 'recent', 'korean', 'english', 'all', 'published', 'hidden', 'archived', 'draft', 'id', 'title', 'subject', 'state', 'updatedAt']
  const chargeKeys = ['current', 'previous', 'days', 'day', 'byPlan', 'label', 'count', 'amount', 'paymentCount', 'paymentAmount', 'paymentVat', 'refundCount', 'refundAmount', 'refundVat', 'net']
  const combos = [
    { name: '대표', access: owner, allowed: [...marketKeys, 'c', ...activityKeys, 'signups', 'downloads', 'downloadUsers', ...rankKeys, 'chargedCredits', ...productKeys, ...chargeKeys] },
    { name: 'orders.view', access: staff('orders.view'), allowed: [...marketKeys, ...activityKeys, 'downloads', 'downloadUsers', ...rankKeys] },
    { name: 'orders.view + reports.view', access: staff('orders.view', 'reports.view'), allowed: [...marketKeys, 'c', ...activityKeys, 'downloads', 'downloadUsers', ...rankKeys, 'chargedCredits', ...chargeKeys] },
    { name: 'members.view', access: staff('members.view'), allowed: [...activityKeys, 'signups'] },
    { name: 'products.edit', access: staff('products.edit'), allowed: [...productKeys] },
  ]
  for (const combo of combos) {
    const { data } = await readDashboard(combo.access)
    const allowed = new Set([...base, ...combo.allowed])
    const extra = [...collectKeys(data)].filter((key) => !allowed.has(key))
    assert.deepEqual(extra, [], combo.name)
  }
  // orders.view 만: 상품 현황이 없으므로 순위 빈 상태에 공개 상품 수가 실릴 수 없다
  const ordersOnly = await readDashboard(staff('orders.view'), { rpc: { ...fullRpc(), report_market_item_ranking: [] } })
  assert.equal(ordersOnly.data.products, null)
  assert.deepEqual(ordersOnly.data.orderRanking, { failed: false, data: [] })
  assert.match(client, /const published = permissions\.products && publishedCount !== null/)
  // members.view 없음: 가입 수 없음. products.edit 없음: 상품 현황·[상품 등록] 없음
  const noMembers = await readDashboard(staff('orders.view'))
  assert.equal(noMembers.data.activity.data.totals.signups, undefined)
  assert.equal(noMembers.data.products, null)
  assert.match(client, /action=\{permissions\.products \? <Button asChild variant="adminTable" size="sm"><Link href=\{newProductHref\}>상품 등록<\/Link><\/Button> : undefined\}/)
  assert.match(client, /\{permissions\.products \? \(\s*<section aria-label="상품 현황"/)
})

test('권한 없는 구역의 함수는 부르지 않는다', async () => {
  const none = await readDashboard(staff())
  assert.equal(none.calls.rpc.length, 0)
  assert.equal(none.calls.queries.length, 0)
  for (const key of ['charge', 'market', 'activity', 'orderRanking', 'downloadRanking', 'products']) assert.equal(none.data[key], null, key)

  const members = await readDashboard(staff('members.view'))
  assert.deepEqual([...new Set(members.calls.rpc.map((call) => call.name))], ['report_activity_daily'])
  assert.deepEqual(members.data.activity.data.totals, { signups: 2 })

  // reports.view 는 orders.view 와 함께여야 한다(권한 정의) — 혼자면 아무것도 읽지 않는다
  const reportsOnly = await readDashboard(staff('reports.view'))
  assert.equal(reportsOnly.calls.rpc.length, 0)

  const owners = await readDashboard(owner)
  assert.deepEqual([...new Set(owners.calls.rpc.map((call) => call.name))].sort(), ['report_activity_daily', 'report_charge_daily', 'report_market_daily', 'report_market_item_ranking'])
  // 지금 기간·앞 기간을 따로 부른다(과목 전체 = NULL)
  const period = resolve()
  const marketCalls = owners.calls.rpc.filter((call) => call.name === 'report_market_daily').map((call) => call.args)
  assert.deepEqual(marketCalls, [
    { p_from: period.current.from, p_to: period.current.to, p_subject: null },
    { p_from: period.compare.from, p_to: period.compare.to, p_subject: null },
  ])
  assert.deepEqual(owners.calls.rpc.filter((call) => call.name === 'report_market_item_ranking').map((call) => [call.args.p_metric, call.args.p_limit]), [['orders', 5], ['downloads', 5]])
})

test('과목 필터는 그 과목만 넘기고, 상품 현황은 요청할 때만 읽는다', async () => {
  const loaded = loadDashboardServer({ rpc: fullRpc(), tables: { market_items: productRows } })
  const data = await loaded.server.getAdminDashboard(owner, resolve({ period: '7d', subject: 'english' }), { includeProducts: false })
  assert.ok(loaded.calls.rpc.filter((call) => call.name !== 'report_charge_daily').every((call) => call.args.p_subject === 'english'))
  // 충전에는 과목이 없다(과목 무관)
  assert.ok(loaded.calls.rpc.filter((call) => call.name === 'report_charge_daily').every((call) => !('p_subject' in call.args)))
  assert.equal('products' in data, false)
  assert.equal(loaded.calls.queries.some((query) => query.table === 'market_items'), false)
})

test('report_market_daily: 날짜당 1행(≤ 367)을 그대로 싣는다 — 행을 나누거나 자르지 않는다', async () => {
  const days = Array.from({ length: 366 }, (_, index) => new Date(Date.UTC(2025, 10, 26 + index)).toISOString().slice(0, 10))
  const { data } = await readDashboard(owner, { rpc: { ...fullRpc(), report_market_daily: marketDaily(days) } })
  assert.equal(data.market.data.days.length, 366)
  assert.ok(data.market.data.days.length <= 367)
  assert.match(migration, /RETURNS TABLE\(day date, purchases jsonb, refunds jsonb\)/)
  assert.match(migration, /generate_series\(\(p_from AT TIME ZONE 'Asia\/Seoul'\)::date, \(\(p_to - interval '1 microsecond'\) AT TIME ZONE 'Asia\/Seoul'\)::date, interval '1 day'\)/)
  assert.equal(migration.match(/p_to - p_from > interval '367 days'/g).length, 3)
})

test('REFUND_AMOUNT_MISSING 이어도 자료 판매·활동 카드는 정상, 앞 기간만 실패하면 증감만 확인 불가', async () => {
  const { data, errors } = await readDashboard(owner, { rpc: { ...fullRpc(), report_charge_daily: { error: { code: 'P0001', message: 'REFUND_AMOUNT_MISSING' } } } })
  assert.deepEqual(data.charge, { failed: true })
  assert.equal(data.market.failed, false)
  assert.equal(data.activity.failed, false)
  assert.equal(data.orderRanking.failed, false)
  assert.ok(errors.length >= 1)

  const period = resolve()
  const previousFails = await readDashboard(owner, {
    rpc: { ...fullRpc(), report_charge_daily: (args) => (args.p_from === period.compare.from ? { error: { message: 'timeout' } } : fullRpc().report_charge_daily) },
  })
  assert.equal(previousFails.data.charge.failed, false)
  assert.equal(previousFails.data.charge.data.previous, null)
  assert.deepEqual(previousFails.data.charge.data.current, { paymentCount: 2, paymentAmount: 20000, paymentVat: 1818, refundCount: 1, refundAmount: 1000, refundVat: 91, net: 19000 })
  // 요금제별 합 = 결제 금액(D2 와 같은 대조)
  assert.equal(previousFails.data.charge.data.byPlan.reduce((sum, plan) => sum + plan.amount, 0), 20000)
  assert.match(client, /formatDelta\(charge\.current\.net, valueOrUnavailable\(charge\.previous\?\.net\)\)/)
})

test('DB 함수가 아직 없으면(묶음 미적용) 그 구역만 실패로 두고 화면은 그린다', async () => {
  const { data } = await readDashboard(owner, { rpc: { report_charge_daily: fullRpc().report_charge_daily } })
  assert.equal(data.charge.failed, false)
  for (const key of ['market', 'activity', 'orderRanking', 'downloadRanking']) assert.deepEqual(data[key], { failed: true }, key)
  assert.equal(data.products.failed, false)
})

test('자료 판매 합계(Q6): 큰 값 = 구매 C − 환불 C, 보조 줄 = 구매 n건 X C · 환불 m건 Y C, 도넛 합 = 구매 C', async () => {
  const { data } = await readDashboard(owner)
  const summary = fields.summarizeMarket(data.market.data.days)
  assert.deepEqual({ ...summary, slices: undefined }, { purchaseCount: 3, refundCount: 1, purchaseCredits: 9500, refundCredits: 2500, netCredits: 7000, slices: undefined })
  assert.equal(summary.slices.reduce((sum, slice) => sum + slice.c, 0), summary.purchaseCredits)
  const ordersOnly = await readDashboard(staff('orders.view'))
  const limited = fields.summarizeMarket(ordersOnly.data.market.data.days)
  assert.equal(limited.purchaseCount, 3)
  assert.equal(limited.netCredits, null)
  assert.equal(limited.purchaseCredits, null)
})

test('상품 현황: 공개 = 회원 화면 조건, 숨김 = hidden + 내린 공개, 임시저장은 자동 업로드 제외, 삭제 제외', async () => {
  const { data } = await readDashboard(owner)
  assert.deepEqual(data.products.data.counts, {
    korean: { published: 1, hidden: 1, archived: 0, draft: 1 },
    english: { published: 0, hidden: 1, archived: 1, draft: 0 },
  })
  assert.deepEqual(data.products.data.recent.all.map((item) => item.id), ['p1', 'p2', 'p3'])
  assert.deepEqual(data.products.data.recent.english.map((item) => [item.id, item.state]), [['p3', 'hidden'], ['p7', 'archived']])
})

test('pickDashboardFields: 한 곳에서 jsonb 안쪽까지 거른다', () => {
  const row = { day: '2026-11-01', purchases: { korean: { subproduct: { n: 1, c: 10 }, legacy: { n: 2, c: 20 } } }, refunds: { korean: { n: 1, c: 5 } } }
  assert.deepEqual(fields.pickDashboardFields(staff('orders.view'), 'market', row), { day: '2026-11-01', purchases: { korean: { subproduct: { n: 1 }, legacy: { n: 2 } } }, refunds: { korean: { n: 1 } } })
  assert.deepEqual(fields.pickDashboardFields(staff('orders.view', 'reports.view'), 'market', row), row)
  assert.equal(fields.pickDashboardFields(staff('members.view'), 'market', row), null)
  assert.deepEqual(fields.pickDashboardFields(staff('members.view'), 'activityTotals', { signups: 1, downloads: 2, downloadUsers: 1 }), { signups: 1 })
  // 서버는 이 함수만 거쳐 싣는다
  assert.equal(server.match(/pickDashboardFields\(access, '/g).length, 6)
})

test('문구 행: 키마다 따로 읽고, 행이 없으면 null(말풍선 숨김·빈 상태 숫자만)', () => {
  assert.equal(fields.parseDashboardContent(null), null)
  assert.deepEqual(fields.parseDashboardContent({ helpCharge: ' 설명 ', emptyDonut: '', publishedCount: 'a\nb', extra: 'x' }), { helpCharge: '설명' })
  assert.equal(fields.fillCount('공개 상품 {count}개', '147'), '공개 상품 147개')
  // 스크립트의 키 = 코드의 키
  const scriptKeys = [...contentScript.match(/ARRAY\['helpCharge'[\s\S]*?\]/)[0].matchAll(/'(\w+)'/g)].map((match) => match[1])
  assert.deepEqual(scriptKeys, [...fields.DASHBOARD_CONTENT_KEYS])
  assert.match(contentScript, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(client, /content\?\.helpCharge/)
  assert.match(client, /content\?\.emptyDonut \?\? formatCount\(0\)/)
})

test('최근 목록: 탭 하나 = attachMemberContacts 한 번(screen dashboard, 이메일만), 답변 대기는 오래된 순·본문 없음', async () => {
  const tickets = [
    { id: 't2', subject: '두 번째', status: 'pending', created_at: '2026-11-20T00:00:00Z', user_id: 'u2', is_deleted_by_user: false },
    { id: 't1', subject: '첫 번째', status: 'pending', created_at: '2026-11-19T00:00:00Z', user_id: 'withdrawn', is_deleted_by_user: false },
    { id: 't3', subject: '삭제됨', status: 'pending', created_at: '2026-11-18T00:00:00Z', user_id: 'u3', is_deleted_by_user: true },
    { id: 't4', subject: '답변함', status: 'resolved', created_at: '2026-11-17T00:00:00Z', user_id: 'u4', is_deleted_by_user: false },
  ]
  const loaded = loadDashboardServer({ tables: { support_tickets: tickets } })
  const recent = await loaded.server.getDashboardRecent(owner, 'support')
  assert.equal(recent.failed, false)
  assert.deepEqual(recent.rows.map((row) => [row.id, row.subject, row.memberWithdrawn]), [['t1', '탈퇴 회원 문의', true], ['t2', '두 번째', false]])
  assert.equal(loaded.calls.contacts.length, 1)
  assert.equal(loaded.calls.contacts[0].screen, 'dashboard')
  assert.deepEqual(loaded.calls.contacts[0].fields, ['email'])
  const query = loaded.calls.queries.find((item) => item.table === 'support_tickets')
  assert.doesNotMatch(query.ops.find(([name]) => name === 'select')[1], /message|admin_response|\*/)

  // 기록 실패면 이메일을 가린다
  const failed = loadDashboardServer({ tables: { payment_orders: [{ id: 'p1', order_id: 'O1', user_id: 'u1', status: 'completed', plan_name_snapshot: '기본', expected_amount: 9900, created_at: '2026-11-20T00:00:00Z', provider_environment: 'live' }] }, logged: false })
  const charge = await failed.server.getDashboardRecent(owner, 'charge')
  assert.equal(charge.rows[0].email, null)
  // 테스트 환경 주문은 최근 충전 주문에서 뺀다
  assert.ok(failed.calls.queries.find((item) => item.table === 'payment_orders').ops.some(([name, column, value]) => name === 'eq' && column === 'provider_environment' && value === 'live'))

  // 이메일은 attachMemberContacts 로만 붙인다(profiles 끼워 읽기 없음)
  assert.doesNotMatch(server, /profiles!|from\('profiles'\)/)
})

function loadRecentRoute(session) {
  const calls = []
  const route = load('src/app/api/admin/stats/recent/route.ts', {
    'next/server': { NextResponse },
    ...adminGuardMocks(session),
    '@/lib/admin-request-meta': load('src/lib/admin-request-meta.ts'),
    '@/lib/admin-dashboard-fields': fields,
    '@/lib/admin-dashboard-server': {
      isDashboardRecentTab: fields.isDashboardRecentTab,
      canSeeRecentTab: fields.canSeeRecentTab,
      getDashboardRecent: async (access, tab) => { calls.push({ access, tab }); return { tab, failed: false, rows: [] } },
    },
  })
  return { get: (tab) => route.GET(new Request(`http://localhost/api/admin/stats/recent?tab=${tab}`)), calls }
}

test('최근 목록 route: 탭마다 권한을 다시 보고, no-store', async () => {
  const ordersStaff = loadRecentRoute({ role: 'staff', grants: [{ permission: 'orders.view', limits: {} }] })
  const ok = await ordersStaff.get('market')
  assert.equal(ok.status, 200)
  // 시험용 NextResponse 는 headers 를 버리므로 no-store 는 소스로 본다
  assert.match(recentRoute, /const NO_STORE = \{ 'Cache-Control': 'no-store' \}/)
  assert.equal(recentRoute.match(/headers: NO_STORE/g).length, 5)
  assert.equal((await ordersStaff.get('support')).status, 403)
  assert.equal((await ordersStaff.get('nope')).status, 400)
  assert.deepEqual(ordersStaff.calls.map((call) => call.tab), ['market'])
  const supportStaff = loadRecentRoute({ role: 'staff', grants: [{ permission: 'support.manage', limits: {} }] })
  assert.equal((await supportStaff.get('support')).status, 200)
  assert.equal((await supportStaff.get('charge')).status, 403)
  assert.equal((await loadRecentRoute({ role: 'staff' }).get('market')).status, 403)
  assert.match(statsRoute, /NextResponse\.json\(\{ period, work, dashboard \}, \{ headers: NO_STORE \}\)/)
})

test('데이터 읽는 길 하나: 첫 화면은 서버, 마운트 때 fetch 없음, 기간 변경 때 최근 목록·상품 현황 재조회 없음, 늦은 응답은 버림', () => {
  // 첫 화면: 같은 검사·같은 함수, 첫 탭도 서버에서
  assert.match(page, /const period = resolveDashboardPeriod\(parseDashboardQuery\(params, now\), now\)/)
  assert.match(page, /access \? getAdminDashboard\(access, period, \{ includeProducts: true \}\) : null/)
  assert.match(page, /access && recentTab \? getDashboardRecent\(access, recentTab\) : null/)
  assert.match(statsRoute, /const period = resolveDashboardPeriod\(parseDashboardQuery\(url\.searchParams, now\), now\)/)
  // 마운트 때 부르지 않는다
  assert.doesNotMatch(client, /useEffect/)
  // 기간·과목 변경: 숫자만(상품 현황 빼고), 주소는 replaceState
  assert.match(client, /const changeQuery = \(query: DashboardQuery\) => \{\s*\/\/[^\n]*\n\s*window\.history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\?\$\{dashboardQueryString\(query\)\}`\)\s*void loadDashboard\(query, false\)\s*\}/)
  // 한 번 연 탭은 다시 부르지 않는다(열람 기록도 다시 남지 않음). [새로고침]만 비우고 지금 탭을 다시 읽는다.
  assert.match(client, /const openRecentTab = \(tab: DashboardRecentTab\) => \{\s*setRecentTab\(tab\)\s*if \(!recentByTab\[tab\]\) void loadRecent\(tab\)\s*\}/)
  assert.equal(client.match(/void loadRecent\(/g).length, 3)
  assert.match(client, /const refreshAll = \(\) => \{\s*void loadDashboard\(period\.query, true\)\s*alerts\?\.refresh\(\)\s*setRecentByTab\(\{\}\)\s*if \(recentTab\) void loadRecent\(recentTab\)\s*\}/)
  // 앞 요청은 끊고 마지막 요청의 응답만 반영
  assert.match(client, /requestRef\.current\?\.abort\(\)/)
  assert.match(client, /const sequence = \+\+sequenceRef\.current/)
  assert.match(client, /if \(sequence !== sequenceRef\.current\) return\s*if \(!response\.ok \|\| !data\) throw/)
  // 서버 안의 구역 호출은 함께 보낸다
  assert.match(server, /await Promise\.all\(\[\s*can\.money \? settle\('충전'/)
})

test('화면: 판매 중지 버튼은 대표만, 처리 대기 = 알림 요약 값, 권한 없는 이동 링크 없음, 그래프는 늦게·자리 고정', () => {
  assert.match(page, /<PaymentSalesPanel status=\{salesStatus\} canStopSales=\{hasAdminPermission\(access, 'owner'\)\} \/>/)
  assert.match(client, /const work: AdminWorkSummary \| null = alerts\?\.loadFailed \? null : alerts\?\.summary\?\.work \?\? workFallback/)
  // 상태 바: 0 이 아닌 처리 대기 칩, 판매 중지·결제 경보면 빨간 테두리
  assert.match(client, /visibleWorkItems\(work\)\.filter\(\(item\) => \(work \? work\[item\.key\] \?\? null : null\) !== 0\)/)
  assert.match(client, /const attention = salesAttention \|\| paymentAlert/)
  // 이동 링크는 대상 화면 권한이 있을 때만
  assert.match(client, /permissions\.members && !withdrawn \? <Link href=\{`\/admin\/users\/\$\{userId\}`\}/)
  assert.match(client, /permissions\.products \? <Link href=\{productHref\(row\.subject\)\}/)
  assert.match(client, /if \(!permissions\.orders \|\| \(card !== 'charge' && card !== 'market'\)\) return undefined/)
  // 그래프: next/dynamic, 고정 높이 뼈대(280·240), 0 이어도 축·기준선
  assert.match(client, /dynamic\(\(\) => import\('\.\/dashboard-charts'\)[\s\S]*?ssr: false,\s*loading: \(\) => <ChartPlaceholder height=\{280\} \/>/)
  assert.match(client, /loading: \(\) => <ChartPlaceholder height=\{240\} \/>/)
  assert.match(charts, /className="relative h-\[280px\] w-full"/)
  assert.match(charts, /<ReferenceLine y=\{0\}/)
  assert.match(charts, /fill: 'var\(--admin-tone-neutral-border\)'/)
  assert.match(client, /'표로 보기'/)
  // 볼 카드가 없으면 권한 안내
  assert.match(client, /볼 수 있는 지표가 없습니다\(권한\)\./)
  // 오늘(진행 중)·주 단위(90일 초과)
  assert.match(client, /'오늘\(진행 중\)'/)
  assert.match(client, /period\.days\.length > DASHBOARD_WEEKLY_AFTER_DAYS/)
  // Recharts 는 ^ 없이 고정(Q4)
  assert.match(read('package.json'), /"recharts": "3\.\d+\.\d+"/)
})

test('추이 그래프 Y축은 늘 0 을 포함하고(기준선), 음수 날은 0 아래로 그대로', () => {
  assert.deepEqual(fields.trendYDomain([0, 0, 0]), [0, 1])
  assert.deepEqual(fields.trendYDomain([1200, 900, 1500]), [0, 1500])
  assert.deepEqual(fields.trendYDomain([5000]), [0, 5000])
  assert.deepEqual(fields.trendYDomain([3000, -1000, 0]), [-1000, 3000])
  assert.deepEqual(fields.trendYDomain([-500, -200]), [-500, 0])
  assert.deepEqual(fields.trendYDomain([]), [0, 1])
  assert.match(charts, /domain=\{trendYDomain\(points\.map\(\(point\) => point\.value\)\)\}/)
  assert.match(charts, /<ReferenceLine y=\{0\} stroke="var\(--studio-control-border\)" ifOverflow="extendDomain" \/>/)
  assert.doesNotMatch(charts, /'auto'/)
  // 그래프는 role=img 한 덩어리(초점 층 끔), 주 막대 링크는 표 보기에도
  assert.equal(charts.match(/accessibilityLayer=\{false\}/g).length, 2)
  assert.match(client, /cell: \(point\) => \(point\.href \? <Link href=\{point\.href\}/)
  // 상태 바 슬랙 글은 좁은 화면에서 줄바꿈
  assert.match(client, /className="ml-auto break-keep text-xs md:whitespace-nowrap"/)
})

test('DB 함수 없음(PGRST202·42883)과 그 밖 오류는 로그 kind 로 가른다(화면은 둘 다 확인 불가)', async () => {
  const missing = await readDashboard(owner, { rpc: { report_charge_daily: fullRpc().report_charge_daily } })
  const kinds = missing.errors.map((args) => args[1]?.kind)
  assert.ok(kinds.length > 0 && kinds.every((kind) => kind === 'function_missing'), JSON.stringify(kinds))
  const broken = await readDashboard(owner, { rpc: { ...fullRpc(), report_market_daily: { error: { code: '57014', message: 'canceling statement due to statement timeout' } } } })
  assert.deepEqual(broken.data.market, { failed: true })
  assert.deepEqual([...new Set(broken.errors.map((args) => args[1]?.kind))], ['query_failed'])
  const pg = await readDashboard(owner, { rpc: { ...fullRpc(), report_activity_daily: { error: { code: '42883', message: 'function does not exist' } } } })
  assert.deepEqual([...new Set(pg.errors.map((args) => args[1]?.kind))], ['function_missing'])
})

test('의존성: recharts·react-is 는 정확한 판, @reduxjs/toolkit 은 overrides 로 고정', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.dependencies['react-is'], pkg.dependencies.react)
  assert.match(pkg.dependencies.recharts, /^\d+\.\d+\.\d+$/)
  assert.match(pkg.overrides['@reduxjs/toolkit'], /^\d+\.\d+\.\d+$/)
})

test('마이그레이션: 함수 3개 INVOKER·STABLE·search_path·service_role 만, 돈·개인정보 칸 없음, down·VERIFY', () => {
  for (const name of ['report_market_daily', 'report_activity_daily', 'report_market_item_ranking']) {
    assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${name}\\([^)]*\\)[\\s\\S]*?STABLE\\s*SECURITY INVOKER\\s*SET search_path TO 'public', 'pg_temp'`))
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`))
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role;`))
    assert.match(down, new RegExp(`DROP FUNCTION public\\.${name}\\(`))
  }
  const bodies = migration.slice(migration.indexOf('[21번] 시작'), migration.indexOf('[21번] 끝'))
  assert.doesNotMatch(bodies.replace(/--[^\n]*/g, ''), /email|phone|display_tag|payment_orders|refund_amount|expected_amount/)
  assert.match(migration, /SET LOCAL lock_timeout = '3s';/)
  assert.match(migration, /NOTIFY pgrst, 'reload schema';/)
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ''), /ALTER TABLE|CREATE POLICY|CREATE TRIGGER|CREATE INDEX/)
  // 가입은 관리자 제외·과목 무관, 자료 환불은 승인·처리 시각
  assert.match(migration, /p\.is_admin IS NOT TRUE/)
  assert.match(migration, /CASE WHEN o\.purchase_type IN \('subproduct', 'bundle'\) THEN o\.purchase_type ELSE 'legacy' END/)
  assert.match(migration, /ORDER BY g\.n DESC, g\.c DESC, i\.id ASC/)
  assert.match(migration, /ORDER BY g\.users DESC, g\.n DESC, i\.id ASC/)
})

test('리허설: 생성 파일이 최신, light 에 표 잠금 DDL·이력 쓰기·COMMIT 없음, D2 는 11월 예시를 맞춘다', () => {
  const files = buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle21_rehearsal/${name}`), content, `${name} 이 생성기와 같다`)
    assert.doesNotMatch(content, /\bCOMMIT\s*;/)
    assert.match(content.trimEnd(), /ROLLBACK;$/)
  }
  const light = files['a_light.sql'].replace(/--[^\n]*/g, '').replace(/^SELECT pg_temp\.ctx_set\('src_[\s\S]*?\$rh_src_\w+\$\);$/gm, '')
  for (const word of LIGHT_FORBIDDEN) assert.ok(!light.includes(word), `light: ${word}`)
  assert.match(files['b_full.sql'], /INSERT INTO supabase_migrations\.schema_migrations \(version, name\) VALUES \('20261223100000', 'bundle21_dashboard_reports'\);/)
  assert.match(files['a_light.sql'], new RegExp(`'D2', '카드 큰 값\\(순 사용 C\\)'`))
  assert.equal(NOVEMBER_EXAMPLE.net, NOVEMBER_EXAMPLE.orderCredits - NOVEMBER_EXAMPLE.refundCredits)
  assert.match(files['a_light.sql'], /SET LOCAL ROLE anon;/)
  // 시험 계정만
  assert.match(files['a_light.sql'], /WHERE u\.email LIKE '%@test\.com'/)
})

test('권한 정의: reports.view 는 orders.view 와 함께(Q1 기본안)', () => {
  assert.equal(permissions.hasAdminPermission(staff('reports.view'), 'reports.view'), false)
  assert.equal(permissions.hasAdminPermission(staff('orders.view', 'reports.view'), 'reports.view'), true)
  assert.ok(NOW instanceof Date)
})
