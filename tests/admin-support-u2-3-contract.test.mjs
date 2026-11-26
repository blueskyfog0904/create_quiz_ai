import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, NextResponse, adminGuardMocks } from './helpers/market-images-harness.mjs'
import { memberNotificationsServer } from './helpers/member-notifications-harness.mjs'

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
  // 13번 8-2: 회원 찾기는 세션으로 profiles 를 읽지 않고 서버 키 함수가 한다(탈퇴 회원 제외).
  const supportServer = read('src/lib/admin-support-server.ts')
  assert.doesNotMatch(page, /\.from\('profiles'\)/)
  assert.match(page, /const matched = await findSupportMemberIdsByEmail\(keyword, SEARCH_MATCH_LIMIT\)/)
  assert.match(page, /searchTruncated = matched\.truncated/)
  assert.match(page, /buildSupportTicketSearchFilter\(keyword, matched\.ids\)/)
  assert.match(supportServer, /\.from\('profiles'\)\s+\.select\('id'\)\s+\.ilike\('email', `%\$\{escapeIlike\(emailKeyword\)\}%`\)\s+\.is\('withdrawn_at', null\)\s+\.order\('id'\)\s+\.limit\(limit \+ 1\)/)
  assert.match(supportServer, /truncated: ids\.length > limit/)
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

// 13번 5절: 답변 저장은 서버 키 DB 함수(save_support_ticket_answer)가 한다(세션 UPDATE 없음). 회원 삭제·없는 문의는 함수가 거부한다.
const PAGE_CONTENT = {
  revision: 1,
  member: { answerCreatedNotificationTitle: '답변 등록', answerCreatedNotificationMessage: '제목: {문의제목}', answerEditedNotificationTitle: '답변 수정', answerEditedNotificationMessage: '수정: {문의제목}' },
  admin: { templateBlankMarker: '○○', answerEditReasonGuide: '', notifyOnAnswerEdit: true, accessLogRetentionYears: 2 },
}

function loadTicketRoute(rpcResult) {
  const queries = []
  const rpcCalls = []
  const { client: session } = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    return { data: null, error: null }
  })
  const route = load('src/app/api/admin/support/tickets/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient: async () => session },
    // DB 함수와 회원 알림은 서버 키로 부른다(세션 쪽 queries에는 아무것도 남지 않는다). 16번: 알림은 공용 함수(서버 키)가 넣는다.
    '@/lib/member-notifications-server': memberNotificationsServer({
      insert: async (row) => (queries.push({ table: 'notifications', ops: [['insert', row]], viaServiceRole: true }), { error: null }),
    }),
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        rpc: async (name, args) => (rpcCalls.push({ name, args }), rpcResult),
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: TICKET, admin_response: '최신' }, error: null }) }) }),
        }),
      }),
    },
    '@/lib/admin-request-meta': load('src/lib/admin-request-meta.ts'),
    '@/lib/support-page-content-server': { getSupportPageContent: async () => PAGE_CONTENT },
    '@/lib/support-page-content': load('src/lib/support-page-content.ts'),
    '@/lib/support-reply-template': load('src/lib/support-reply-template.ts'),
    ...adminGuardMocks({ userId: 'admin-1' }),
  })
  const body = { adminResponse: '답변', expectedSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', operationKey: '33333333-3333-4333-8333-333333333333' }
  const patch = (extra = {}) => route.PATCH({ json: async () => ({ ...body, ...extra }), headers: new Headers() }, { params: Promise.resolve({ id: TICKET }) })
  return { patch, queries, rpcCalls }
}

test('답변 route는 DB 함수로만 저장하고, 회원이 삭제한 문의는 거부하며 알림도 만들지 않는다', async () => {
  const ticket = { id: TICKET, user_id: MEMBER, subject: '문의' }
  const ok = loadTicketRoute({ data: { ticket, isEdit: false, historyId: null, replayed: false }, error: null })
  assert.equal((await ok.patch()).status, 200)
  assert.deepEqual(ok.rpcCalls.map(({ name }) => name), ['save_support_ticket_answer'])
  assert.equal(ok.rpcCalls[0].args.p_ticket_id, TICKET)
  assert.equal(ok.rpcCalls[0].args.p_actor_id, 'admin-1')
  assert.equal(ok.queries.some((query) => query.table === 'support_tickets'), false)
  const notification = ok.queries.find((query) => query.table === 'notifications')
  assert.ok(notification?.viaServiceRole)
  // 문구는 member_notification_texts 첫 값(13번 문구를 복사한 값)
  assert.match(notification.ops[0][1].message, /^제목: 문의\n/)

  // 회원이 삭제한 문의는 DB 함수가 거부한다
  const rejected = loadTicketRoute({ data: null, error: { message: 'SUPPORT_TICKET_DELETED_BY_MEMBER' } })
  const response = await rejected.patch()
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /회원이 삭제한 문의/)
  assert.equal(rejected.queries.some((query) => query.table === 'notifications'), false)

  // 빈칸 표시가 남은 답변은 DB 함수를 부르지 않는다
  const blank = loadTicketRoute({ data: { ticket, isEdit: false, historyId: null, replayed: false }, error: null })
  assert.equal((await blank.patch({ adminResponse: '환불 금액은 ○○원입니다' })).status, 400)
  assert.equal(blank.rpcCalls.length, 0)

  // 재요청(replayed)이면 알림을 다시 보내지 않는다
  const replayed = loadTicketRoute({ data: { ticket, isEdit: false, historyId: null, replayed: true }, error: null })
  assert.equal((await replayed.patch()).status, 200)
  assert.equal(replayed.queries.some((query) => query.table === 'notifications'), false)

  // 충돌이면 409 와 최신 답변
  const conflict = loadTicketRoute({ data: null, error: { message: 'SUPPORT_ANSWER_CONFLICT' } })
  const conflicted = await conflict.patch()
  assert.equal(conflicted.status, 409)
  const conflictBody = await conflicted.json()
  assert.equal(conflictBody.code, 'SUPPORT_ANSWER_CONFLICT')
  assert.equal(conflictBody.latest.admin_response, '최신')
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
    '@/lib/member-notifications-server': memberNotificationsServer(),
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => paymentAdmin },
    '@/lib/credit-balance': {},
    '@/lib/admin-orders-server': {},
    '@/lib/signup-consent-server': {},
    '@/lib/admin-orders': orders,
    '@/lib/admin-permissions': permissions,
    '@/lib/payment-review-actions': {},
    // 10번: 회원 상세의 탈퇴 구역·가림 모듈(회원 요약은 쓰지 않음)
    '@/lib/member-withdrawal-server': {},
    '@/lib/member-withdrawal': {},
    '@/lib/withdrawn-member-redaction-server': {},
    // 12번: 회원 상세의 정지·메모 구역 모듈(회원 요약은 쓰지 않음)
    '@/lib/admin-member-suspension-server': {},
  }, errors)
  return { server, queries, errors }
}

test('회원 요약: 건수만 세고, 권한이 없는 항목은 조회하지 않는다', async () => {
  const counts = { payment_orders: 3, market_purchase_orders: 5, support_tickets: 2, member_suspensions: 1 }
  const all = loadSummary({ counts })
  assert.deepEqual(await all.server.getAdminMemberSummary(owner, MEMBER, TICKET), {
    paymentOrders: { failed: false, data: 3 },
    marketOrders: { failed: false, data: 5 },
    otherTickets: { failed: false, data: 2 },
    // 12번: '정지 중' 배지(members.view) — 활성 정지 건수
    activeSuspensions: { failed: false, data: 1 },
  })
  const suspensionOps = all.queries.find((query) => query.table === 'member_suspensions').ops
  assert.deepEqual(suspensionOps.find(([name]) => name === 'is'), ['is', 'lifted_at', null])
  assert.match(suspensionOps.find(([name]) => name === 'or')[1], /^ends_at\.is\.null,ends_at\.gt\./)
  for (const query of all.queries) {
    assert.deepEqual(query.ops[0], ['select', 'id', { count: 'exact', head: true }], query.table)
    assert.ok(query.ops.some(([name, column, value]) => name === 'eq' && column === 'user_id' && value === MEMBER), query.table)
  }
  // 결제 표는 결제용 클라이언트로, 지금 보는 문의는 빼고 센다.
  assert.equal(all.queries.find((query) => query.table === 'payment_orders').client, 'payment')
  assert.deepEqual(all.queries.find((query) => query.table === 'support_tickets').ops.at(-1), ['neq', 'id', TICKET])

  const supportOnly = loadSummary({ counts })
  assert.deepEqual(await supportOnly.server.getAdminMemberSummary(staff('support.manage'), MEMBER, TICKET), {
    paymentOrders: null, marketOrders: null, otherTickets: { failed: false, data: 2 }, activeSuspensions: null,
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
  // 답변 route도 같은 권한 가드를 쓴다(U3-3 전면 적용).
  assert.match(ticketRoute, /const guard = await requireAdminApiPermission\('support\.manage'\)/)
  assert.doesNotMatch(ticketRoute, /\.select\('is_admin'\)/)
})

test('상세 창의 회원 요약: 창을 열 때 한 번 읽고, 서버가 세지 않은 항목은 그리지 않는다', () => {
  assert.deepEqual(client.match(/fetch\(`[^`]*`/g), [
    'fetch(`/api/admin/support/tickets/${selectedTicketId}/member-summary`',
    'fetch(`/api/admin/support/tickets/${selectedTicket.id}`',
    'fetch(`/api/admin/support/categories/${category.id}`',
    // 13번 7절: 숨긴 카테고리 다시 사용
    'fetch(`/api/admin/support/categories/${category.id}/restore`',
  ])
  assert.match(client, /\}, \[selectedTicketId\]\)/)
  assert.match(client, /\]\.filter\(\(item\) => item\.section\)\s+\/\/ 12번[^\n]*\n\s+const suspension = summary\.data\.activeSuspensions\s+if \(items\.length === 0 && !suspension\) return null/)
  assert.match(client, /summary=\{memberSummary\?\.ticketId === selectedTicket\.id \? memberSummary : null\}/)
  for (const href of ['`/admin/orders?tab=payments&q=${emailQuery}`', '`/admin/orders?tab=market&q=${emailQuery}`', '`/admin/support?q=${emailQuery}&includeDeleted=true`']) {
    assert.ok(client.includes(href), href)
  }
  assert.ok(client.includes('<Link href={`/admin/users/${selectedTicket.user_id}`}'))
})
