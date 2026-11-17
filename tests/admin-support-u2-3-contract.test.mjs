import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, NextResponse } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(admin)/admin/support/page.tsx')
const client = read('src/app/(admin)/admin/support/support-client.tsx')
const ticketRoute = read('src/app/api/admin/support/tickets/[id]/route.ts')
const summaryRoute = read('src/app/api/admin/support/tickets/[id]/member-summary/route.ts')
const memberPage = read('src/app/(admin)/admin/users/[id]/page.tsx')

const orders = load('src/lib/admin-orders.ts')
const permissions = load('src/lib/admin-permissions.ts')
const support = load('src/lib/admin-support.ts', { '@/lib/admin-orders': orders })

const MEMBER = '11111111-1111-4111-8111-111111111111'
const TICKET = '22222222-2222-4222-8222-222222222222'
const owner = { userId: 'admin-1', role: 'owner', grants: {} }
const staff = (...keys) => ({ userId: 'admin-2', role: 'staff', grants: Object.fromEntries(keys.map((key) => [key, {}])) })

test('서버 페이지 나눔: 건수를 먼저 세고 page·pageSize로 한 쪽만 읽는다', () => {
  assert.doesNotMatch(page, /\.limit\(50\)/)
  assert.match(page, /page\?: string\s+pageSize\?: string\s+ticket\?: string/)
  assert.match(page, /getListPagination\(count \?\? 0, resolvedSearchParams\.page, resolvedSearchParams\.pageSize\)/)
  assert.match(page, /\.order\('created_at', \{ ascending: false \}\)\s+\.order\('id', \{ ascending: false \}\)\s+\.range\(pagination\.offset, pagination\.offset \+ pagination\.pageSize - 1\)/)
  // 건수 조회와 목록 조회에 같은 조건을 건다.
  for (const condition of [
    ".eq('is_deleted_by_user', false)", ".eq('is_deleted_by_user', true)", ".eq('status', statusFilter)",
    ".is('category_id', null)", ".eq('category_id', categoryFilter)", '.or(searchFilter)',
  ]) {
    assert.ok(page.includes(`countQuery = countQuery${condition}`), `count ${condition}`)
    assert.ok(page.includes(`ticketsQuery = ticketsQuery${condition}`), `list ${condition}`)
  }
  // 읽지 못한 것을 0건으로 보이지 않게 오류로 올린다.
  assert.match(page, /if \(countError\) throw new Error\(countError\.message\)/)
  assert.match(page, /if \(ticketsError\) throw new Error\(ticketsError\.message\)/)

  // 화면은 받은 한 쪽을 그대로 그리고(자체 목록 상태 없음), 쪽 이동은 주소를 바꿔 서버가 다시 읽게 한다.
  assert.doesNotMatch(client, /setTickets|initialTickets/)
  assert.match(client, /<StudioListPagination\s+page=\{pagination\.page\}\s+pageSize=\{pagination\.pageSize\}\s+totalCount=\{pagination\.totalCount\}/)
  assert.match(client, /onPageChange=\{\(page\) => changeListQuery\(\{ page \}\)\}/)
  assert.match(client, /onPageSizeChange=\{\(pageSize\) => changeListQuery\(\{ pageSize, page: 1 \}\)\}/)
  assert.match(client, /updateListQuery\(window\.location\.search, \{ \.\.\.changes, ticket: null \}\)/)
})

test('건수 카드는 필터와 무관하게 서버가 전체에서 세고, 답변 뒤 다시 읽는다', () => {
  assert.match(page, /\.select\('id', head\)\.eq\('status', 'pending'\)\.eq\('is_deleted_by_user', false\)/)
  assert.match(page, /\.select\('id', head\)\.eq\('status', 'resolved'\)\.eq\('is_deleted_by_user', false\)/)
  assert.match(page, /\.select\('id', head\)\.eq\('is_deleted_by_user', true\)/)
  assert.doesNotMatch(client, /tickets\.filter\(/)
  for (const key of ['pending', 'resolved', 'deleted']) {
    assert.ok(client.includes(`{formatCount(ticketCounts.${key})}`), key)
  }
  assert.match(client, /alerts\?\.refresh\(\)\s+\/\/[^\n]*\s+router\.refresh\(\)/)
})

test('검색 조건: 제목·내용·회원 id를 묶고, 검색어의 구문 글자를 따옴표 안에 가둔다', () => {
  assert.equal(
    support.buildSupportTicketSearchFilter('환불', ['u1', 'u2']),
    'subject.ilike."%환불%",message.ilike."%환불%",user_id.in.(u1,u2)'
  )
  // 맞는 회원이 없으면 제목·내용만 찾는다.
  assert.equal(support.buildSupportTicketSearchFilter('환불', []), 'subject.ilike."%환불%",message.ilike."%환불%"')
  // 쉼표·괄호·점은 따옴표 안이라 그대로, ilike 와일드카드와 따옴표·역슬래시는 막는다.
  assert.equal(
    support.buildSupportTicketSearchFilter('a,b).id.eq.1', []),
    'subject.ilike."%a,b).id.eq.1%",message.ilike."%a,b).id.eq.1%"'
  )
  assert.equal(support.buildSupportTicketSearchFilter('50%_"x"\\', []).split(',')[0], 'subject.ilike."%50\\\\%\\\\_\\"x\\"\\\\\\\\%"')

  // 페이지: 이메일이 맞는 회원 id를 먼저 찾고(상한+1로 넘침 확인), 검색어를 .or()에 직접 넣지 않는다.
  assert.match(page, /\.from\('profiles'\)\.select\('id'\)\.ilike\('email', `%\$\{escapeIlike\(emailKeyword\)\}%`\)\.order\('id'\)\.limit\(SEARCH_MATCH_LIMIT \+ 1\)/)
  assert.match(page, /searchTruncated = matchedUsers\.length > SEARCH_MATCH_LIMIT/)
  assert.match(page, /buildSupportTicketSearchFilter\(keyword, matchedUsers\.slice\(0, SEARCH_MATCH_LIMIT\)\.map\(\(user\) => user\.id\)\)/)
  assert.doesNotMatch(page, /\.or\(`/)
  assert.match(client, /searchTruncated && \(/)
  assert.match(client, /placeholder="제목\/내용\/회원 이메일 검색"/)
})

test('?ticket=<id>: 필터·쪽·삭제 여부와 무관하게 그 한 건을 읽어 상세 창을 연다', () => {
  const linked = page.slice(page.indexOf('const ticketId ='), page.indexOf('return ('))
  assert.match(linked, /UUID_PATTERN\.test\(resolvedSearchParams\.ticket\)/)
  assert.match(linked, /\.from\('support_tickets'\)\.select\(TICKET_COLUMNS\)\.eq\('id', ticketId\)\.maybeSingle\(\)/)
  assert.doesNotMatch(linked, /is_deleted_by_user|status/)
  assert.match(page, /linkedTicket=\{linkedTicket\}/)
  assert.match(page, /key=\{JSON\.stringify\(resolvedSearchParams\)\}/)
  assert.match(client, /useState<Ticket \| null>\(linkedTicket\)/)
  // 회원 상세의 문의 행이 이 링크로 온다.
  assert.ok(memberPage.includes('<Link href={`/admin/support?ticket=${ticket.id}`}'))
})

test('회원이 삭제한 문의: 화면은 열람만, 답변 입력·저장 버튼은 없다', () => {
  assert.match(client, /onClick=\{\(\) => openTicket\(ticket\)\}/)
  assert.doesNotMatch(client, /cursor-not-allowed|!isDeleted && openTicket/)
  assert.equal(client.match(/selectedTicket\?\.status === 'pending' && !selectedTicket\.is_deleted_by_user && \(/g).length, 2)
  assert.doesNotMatch(client, /selectedTicket\?\.status === 'pending' && \(/)
  assert.match(client, /if \(!selectedTicket \|\| selectedTicket\.is_deleted_by_user \|\| !response\.trim\(\)\) return/)
  assert.match(client, /getStatusBadge\(selectedTicket\.is_deleted_by_user \? 'deleted' : selectedTicket\.status\)/)
  assert.match(client, /회원이 삭제한 문의입니다\. 내용만 볼 수 있고 답변은 등록할 수 없습니다\./)
})

function loadTicketRoute(ticketRow) {
  const queries = []
  const { client: session } = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    if (table === 'profiles') return { data: { is_admin: true }, error: null }
    if (table === 'notifications') return { error: null }
    return { data: ticketRow, error: null }
  })
  session.auth = { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) }
  const route = load('src/app/api/admin/support/tickets/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient: async () => session },
  })
  const patch = () => route.PATCH({ json: async () => ({ adminResponse: '답변' }) }, { params: Promise.resolve({ id: TICKET }) })
  return { patch, queries }
}

test('답변 route는 삭제되지 않은 문의만 고치고, 삭제된 문의는 404로 거부하며 알림도 만들지 않는다', async () => {
  const ok = loadTicketRoute({ id: TICKET, user_id: MEMBER, subject: '문의' })
  assert.equal((await ok.patch()).status, 200)
  const update = ok.queries.find((query) => query.table === 'support_tickets')
  assert.deepEqual(update.ops.filter(([name]) => name === 'eq'), [['eq', 'id', TICKET], ['eq', 'is_deleted_by_user', false]])
  assert.ok(ok.queries.some((query) => query.table === 'notifications'))

  // 조건에 맞는 행이 없다(없는 문의 또는 회원이 삭제한 문의)
  const rejected = loadTicketRoute(null)
  const response = await rejected.patch()
  assert.equal(response.status, 404)
  assert.match((await response.json()).error, /회원이 삭제한 문의/)
  assert.equal(rejected.queries.some((query) => query.table === 'notifications'), false)
})

function loadSummary({ tableErrors = [], counts = {} } = {}) {
  const queries = []
  const errors = []
  const handler = (name) => ({ table, ops }) => {
    queries.push({ client: name, table, ops })
    if (tableErrors.includes(table)) return { count: null, error: { message: `${table} failed` } }
    return { count: counts[table] ?? 0, error: null }
  }
  const { client: admin } = createFakeAdmin(handler('admin'))
  const { client: paymentAdmin } = createFakeAdmin(handler('payment'))
  const server = load('src/lib/admin-member-detail-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => paymentAdmin },
    '@/lib/credit-balance': {},
    '@/lib/admin-orders-server': {},
    '@/lib/admin-orders': orders,
    '@/lib/admin-permissions': permissions,
    '@/lib/payment-review-actions': {},
  }, errors)
  return { server, queries, errors }
}

test('회원 요약: 건수만 세고, 권한이 없는 항목은 조회하지 않는다', async () => {
  const counts = { payment_orders: 3, market_purchase_orders: 5, support_tickets: 2 }
  const all = loadSummary({ counts })
  assert.deepEqual(await all.server.getAdminMemberSummary(owner, MEMBER, TICKET), {
    paymentOrders: { failed: false, data: 3 },
    marketOrders: { failed: false, data: 5 },
    otherTickets: { failed: false, data: 2 },
  })
  for (const query of all.queries) {
    assert.deepEqual(query.ops[0], ['select', 'id', { count: 'exact', head: true }], query.table)
    assert.ok(query.ops.some(([name, column, value]) => name === 'eq' && column === 'user_id' && value === MEMBER), query.table)
  }
  // 결제 표는 결제용 클라이언트로, 지금 보는 문의는 빼고 센다.
  assert.equal(all.queries.find((query) => query.table === 'payment_orders').client, 'payment')
  assert.deepEqual(all.queries.find((query) => query.table === 'support_tickets').ops.at(-1), ['neq', 'id', TICKET])

  const supportOnly = loadSummary({ counts })
  assert.deepEqual(await supportOnly.server.getAdminMemberSummary(staff('support.manage'), MEMBER, TICKET), {
    paymentOrders: null, marketOrders: null, otherTickets: { failed: false, data: 2 },
  })
  assert.deepEqual(supportOnly.queries.map((query) => query.table), ['support_tickets'])

  const ordersOnly = loadSummary({ counts })
  assert.equal((await ordersOnly.server.getAdminMemberSummary(staff('orders.view'), MEMBER, TICKET)).otherTickets, null)
  assert.deepEqual(ordersOnly.queries.map((query) => query.table).sort(), ['market_purchase_orders', 'payment_orders'])

  // 한 항목을 읽지 못해도 나머지는 그대로다.
  const failed = loadSummary({ counts, tableErrors: ['payment_orders'] })
  const summary = await failed.server.getAdminMemberSummary(owner, MEMBER, TICKET)
  assert.deepEqual(summary.paymentOrders, { failed: true })
  assert.deepEqual(summary.marketOrders, { failed: false, data: 5 })
  assert.equal(failed.errors.length, 1)
})

test('회원 요약 route는 권한 가드를 쓰고 조회만 하며, 회원은 그 문의에서 읽는다', () => {
  assert.match(summaryRoute, /export async function GET\([^)]*\) \{\s*const guard = await requireAdminApiPermission\('support\.manage'\)\s*if \('error' in guard\) \{\s*return NextResponse\.json\(\{ error: guard\.error \}, \{ status: guard\.status \}\)/)
  assert.deepEqual(summaryRoute.match(/export async function (\w+)\(/g), ['export async function GET('])
  assert.doesNotMatch(summaryRoute, /\.(insert|update|upsert|delete|rpc)\(|\.select\('is_admin'\)|searchParams/)
  assert.match(summaryRoute, /if \(!UUID_PATTERN\.test\(id\)\)/)
  assert.match(summaryRoute, /getAdminMemberSummary\(guard\.access, ticket\.user_id, id\)/)
  // 이 단위는 기존 답변 route의 접근 검사 방식을 바꾸지 않는다(전면 적용은 U3-3).
  assert.match(ticketRoute, /\.select\('is_admin'\)/)
  assert.doesNotMatch(ticketRoute, /admin-permissions/)
})

test('상세 창의 회원 요약: 창을 열 때 한 번 읽고, 서버가 세지 않은 항목은 그리지 않는다', () => {
  assert.deepEqual(client.match(/fetch\(`[^`]*`/g), [
    'fetch(`/api/admin/support/tickets/${selectedTicketId}/member-summary`',
    'fetch(`/api/admin/support/tickets/${selectedTicket.id}`',
    'fetch(`/api/admin/support/categories/${category.id}`',
  ])
  assert.match(client, /\}, \[selectedTicketId\]\)/)
  assert.match(client, /\]\.filter\(\(item\) => item\.section\)\s+if \(items\.length === 0\) return null/)
  assert.match(client, /summary=\{memberSummary\?\.ticketId === selectedTicket\.id \? memberSummary : null\}/)
  for (const href of ['`/admin/orders?tab=payments&q=${emailQuery}`', '`/admin/orders?tab=market&q=${emailQuery}`', '`/admin/support?q=${emailQuery}&includeDeleted=true`']) {
    assert.ok(client.includes(href), href)
  }
  assert.ok(client.includes('<Link href={`/admin/users/${selectedTicket.user_id}`}'))
})
