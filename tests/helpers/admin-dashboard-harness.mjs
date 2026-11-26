import { createFakeAdmin, load, op } from './market-images-harness.mjs'

// 21번 대시보드(src/lib/admin-dashboard-server.ts)를 가짜 DB 로 불러온다.
// rpc: { 함수 이름: 값 | (args) => 값 | { error } }. tables: { 표 이름: 행[] } — eq·in·is·gte·order·limit·range 를 실제로 적용한다.
export const permissions = load('src/lib/admin-permissions.ts')
const kstPeriod = load('src/lib/kst-period.ts')
const adminOrders = load('src/lib/admin-orders.ts')
export const salesReport = load('src/lib/sales-report.ts', { '@/lib/admin-orders': adminOrders, '@/lib/kst-period': kstPeriod })
export const period = load('src/lib/admin-dashboard-period.ts', { '@/lib/kst-period': kstPeriod, '@/lib/sales-report': salesReport })
export const fields = load('src/lib/admin-dashboard-fields.ts', { '@/lib/admin-permissions': permissions })
const readAllQueryRows = load('src/lib/read-all-query-rows.ts')

export const owner = { userId: 'admin-1', role: 'owner', grants: {} }
export const staff = (...keys) => ({ userId: 'admin-2', role: 'staff', grants: Object.fromEntries(keys.map((key) => [key, {}])) })

const valueAt = (row, column) => column.split('.').reduce((value, key) => value?.[key], row)

export function loadDashboardServer({ rpc = {}, tables = {}, failTables = [], logged = true } = {}) {
  const calls = { rpc: [], queries: [], contacts: [] }
  const errors = []
  const handler = (client) => ({ table, ops }) => {
    calls.queries.push({ client, table, ops })
    if (failTables.includes(table)) return { data: null, error: { message: `${table} failed` } }
    let rows = tables[table] ?? []
    for (const [name, column, value] of ops) {
      if (name === 'eq') rows = rows.filter((row) => valueAt(row, column) === value)
      if (name === 'in') rows = rows.filter((row) => value.includes(valueAt(row, column)))
      if (name === 'is') rows = rows.filter((row) => (valueAt(row, column) ?? null) === value)
    }
    for (const [name, column, options] of [...ops].reverse()) {
      if (name === 'order') rows = [...rows].sort((a, b) => String(valueAt(a, column)).localeCompare(String(valueAt(b, column))) * (options?.ascending === false ? -1 : 1))
    }
    const range = op(ops, 'range')
    const limit = op(ops, 'limit')
    if (range) rows = rows.slice(range[1], range[2] + 1)
    if (limit) rows = rows.slice(0, limit[1])
    if (op(ops, 'maybeSingle')) return { data: rows[0] ?? null, error: null }
    return { data: rows, error: null }
  }
  const rpcCall = (name, args) => {
    calls.rpc.push({ name, args })
    const spec = rpc[name]
    const value = typeof spec === 'function' ? spec(args) : spec
    const result = value && typeof value === 'object' && 'error' in value && !Array.isArray(value)
      ? { data: null, error: value.error }
      : value === undefined
        ? { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }
        : { data: value, error: null }
    const promise = Promise.resolve(result)
    // supabase-js 의 rpc(...).abortSignal(...) 모양
    return { abortSignal: () => promise, then: (resolve, reject) => promise.then(resolve, reject) }
  }
  const { client: admin } = createFakeAdmin(handler('admin'))
  admin.rpc = rpcCall
  const { client: paymentAdmin } = createFakeAdmin(handler('payment'))
  const server = load('src/lib/admin-dashboard-server.ts', {
    'server-only': {},
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => paymentAdmin },
    '@/lib/read-all-query-rows': readAllQueryRows,
    '@/lib/admin-permissions': permissions,
    '@/lib/sales-report': salesReport,
    '@/lib/admin-dashboard-fields': fields,
    // 10번: 탈퇴 회원 문의 가림(user_id 가 'withdrawn' 인 행만 탈퇴로 본다)
    '@/lib/withdrawn-member-redaction-server': {
      markWithdrawnRows: async (rows, userIdOf, redact) => rows.map((row) => (userIdOf(row) === 'withdrawn'
        ? { ...redact(row, '탈퇴 회원 문의'), memberWithdrawn: true }
        : { ...row, memberWithdrawn: false })),
    },
    // 13번 attachMemberContacts: 기록(호출)을 모으고, 기록 실패면 이메일을 가린다.
    '@/lib/admin-member-access-log-server': {
      attachMemberContacts: async (input) => {
        calls.contacts.push(input)
        return { logged, rows: input.rows.map((row) => input.shape(row, logged ? { id: row.user_id, email: `${row.user_id}@example.com`, phone: null, display_tag: null } : null)) }
      },
    },
  }, errors)
  return { server, calls, errors }
}

// 한국 시간 2026-11-26 15:12(30일 기본 기간)
export const NOW = new Date('2026-11-26T06:12:00Z')
export const resolve = (query = { period: '30d', subject: 'all' }, now = NOW) => period.resolveDashboardPeriod(query, now)

// 가짜 DB 함수 결과
export const chargeDaily = ({ paymentAmount = 20000, refundAmount = 1000 } = {}) => ({
  days: [{
    day: '2026-11-20', paymentCount: 2, paymentAmount, paymentVat: 1818, refundCount: 1, refundAmount, refundVat: 91,
    manualRefundCount: 0, manualRefundAmount: 0, byMethod: [],
    byPlan: [{ name: '기본', count: 1, amount: paymentAmount / 2, vat: 909 }, { name: '프로', count: 1, amount: paymentAmount / 2, vat: 909 }],
    refundByOrigin: [], refundByMethod: [],
  }],
  warnings: { manualReviewOrders: 0, cancelPendingOrders: 0, fulfillmentPendingOrders: 0, partialCancelOpen: 0, fullRefundVatMismatch: 0, manualActionsWithoutRefund: 0 },
})
export const marketDaily = (days = ['2026-11-20']) => days.map((day) => ({
  day,
  purchases: { korean: { subproduct: { n: 2, c: 5000 }, bundle: { n: 1, c: 4500 } }, english: { subproduct: { n: 0, c: 0 }, bundle: { n: 0, c: 0 } } },
  refunds: { korean: { n: 1, c: 2500 }, english: { n: 0, c: 0 } },
}))
export const activityDaily = () => ({ days: [{ day: '2026-11-20', signups: 2, downloads: 3, downloadUsers: 2 }], totals: { signups: 2, downloads: 3, downloadUsers: 2 } })
export const rankingRows = (metric) => [{
  item_id: 'item-1', title: '상품 1', workspace_subject: 'korean', item_status: 'published', is_active: true, is_deleted: false,
  order_count: metric === 'orders' ? 3 : 0, charged_credits: metric === 'orders' ? 9000 : 0,
  download_users: metric === 'downloads' ? 2 : 0, download_count: metric === 'downloads' ? 5 : 0,
}]
export const fullRpc = () => ({
  report_charge_daily: chargeDaily(),
  report_market_daily: marketDaily(),
  report_activity_daily: activityDaily(),
  report_market_item_ranking: (args) => rankingRows(args.p_metric),
})
