import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const page = read('src/app/(admin)/admin/users/[id]/page.tsx')
const lib = read('src/lib/admin-member-detail-server.ts')

const orders = load('src/lib/admin-orders.ts')
const permissions = load('src/lib/admin-permissions.ts')

const MEMBER = '11111111-1111-4111-8111-111111111111'
const owner = { userId: 'admin-1', role: 'owner', grants: {} }
const staff = (...keys) => ({ userId: 'admin-2', role: 'staff', grants: Object.fromEntries(keys.map((key) => [key, {}])) })
const profile = { id: MEMBER, email: 'member@example.com', display_tag: 'AB12', phone: null, created_at: '2026-11-01T00:00:00Z', provider: 'email', is_admin: false, admin_role: null, withdrawn_at: null }
const snapshot = { spendableBalance: 120, expiredBalance: 30, nextExpirationAt: '2027-01-01T00:00:00Z', databaseNow: '2026-11-16T00:00:00Z' }

// lib을 가짜 DB·가짜 목록 함수로 돌린다. tableErrors에 표 이름을 넣으면 그 표 조회가 실패한다.
function loadDetail({ profileRow = profile, profileError = null, tableErrors = [], snapshotError = false, rowsByTable = {} } = {}) {
  const queries = []
  const calls = []
  const errors = []
  const handler = (client) => ({ table, ops }) => {
    queries.push({ client, table, ops })
    if (table === 'profiles') return profileError ? { data: null, error: { message: profileError } } : { data: profileRow, error: null }
    if (tableErrors.includes(table)) return { data: null, count: null, error: { message: `${table} failed` } }
    const rows = rowsByTable[table] ?? []
    return { data: rows, count: rows.length, error: null }
  }
  const { client: admin } = createFakeAdmin(handler('admin'))
  const { client: paymentAdmin } = createFakeAdmin(handler('payment'))
  const server = load('src/lib/admin-member-detail-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => paymentAdmin },
    '@/lib/signup-consent-server': {
      readMemberConsentHistory: async (userId) => {
        calls.push(['consents', userId])
        return []
      },
    },
    '@/lib/credit-balance': {
      getCreditBalanceSnapshot: async (userId) => {
        calls.push(['balance', userId])
        if (snapshotError) throw new Error('rpc failed')
        return snapshot
      },
    },
    '@/lib/admin-orders-server': {
      listPaymentOrdersForAdmin: async (input) => {
        calls.push(['payments', input])
        return { orders: Array.from({ length: 12 }, (_, index) => ({ id: `p${index}` })), totalCount: 12 }
      },
      listMarketOrdersForAdmin: async (input) => {
        calls.push(['market', input])
        return { orders: [{ id: 'm1' }], totalCount: 1, downloadsUnavailable: false, downloadsTruncated: true }
      },
    },
    '@/lib/admin-orders': orders,
    '@/lib/admin-permissions': permissions,
    '@/lib/payment-review-actions': load('src/lib/payment-review-actions.ts'),
    // 10번: 대표 전용 '회원 탈퇴' 구역(미리보기 RPC)과 탈퇴 회원 가림. 여기서는 탈퇴하지 않은 회원이다.
    '@/lib/member-withdrawal-server': {
      readMemberWithdrawalPolicy: async () => ({ texts: {} }),
      readMemberWithdrawalPreview: async (userId) => ({ ok: true, data: { userId, withdrawnAt: null } }),
      readWithdrawnMemberAccountStatus: async () => null,
    },
    '@/lib/member-withdrawal': { withdrawalText: () => null },
    '@/lib/withdrawn-member-redaction-server': {
      readWithdrawnUserIdsForRedaction: async () => new Set(),
      readWithdrawnTicketTitle: async () => '탈퇴 회원 문의',
    },
    // 12번: '이용 정지'·'관리자 메모' 구역(members.view). 읽는 함수에 접근 정보·탈퇴 시각을 넘긴다.
    '@/lib/admin-member-suspension-server': {
      readMemberSuspensionSection: async (access, userId, withdrawnAt) => {
        calls.push(['suspension', userId, withdrawnAt])
        return { withdrawn: withdrawnAt !== null, history: [], active: null }
      },
      readMemberNotesSection: async (userId, withdrawnAt) => {
        calls.push(['notes', userId, withdrawnAt])
        return { withdrawn: withdrawnAt !== null, notes: [] }
      },
    },
  }, errors)
  return { server, queries, calls, errors }
}

const tables = (queries) => queries.map((query) => query.table).sort()

test('페이지는 members.view 가드를 지나 그 접근 정보로 조회하고, 없는 회원은 notFound다', () => {
  assert.match(page, /export default async function AdminMemberDetailPage\([^)]*\) \{\s*const access = await requireAdminPagePermission\('members\.view'\)/)
  assert.match(page, /const detail = await getAdminMemberDetail\(access, id\)\s*if \(!detail\) notFound\(\)/)
  assert.doesNotMatch(page, /requireAdmin\(\)|\.select\('is_admin'\)|createAdminClient|createClient/)
})

test('조회 전용: 쓰기가 없고, 화면은 서버 컴포넌트 하나다(클라이언트 조회·지급 창 없음)', () => {
  for (const source of [page, lib]) {
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete|rpc)\(/)
  }
  assert.doesNotMatch(page, /'use client'|fetch\(|GrantCreditDialog|<form|<button|onClick/)
  // 다운로드 route를 부르거나 다운로드 주소를 만들지 않는다(부르면 다운로드 기록이 생겨 환불 불가가 된다).
  assert.doesNotMatch(page + lib, /\/download|createSignedUrl|storage_path/)
})

test('개인정보: 프로필은 정해 둔 열만 읽고, 생년월일·주소·카카오 ID·성별과 문의 본문은 읽지 않는다', async () => {
  const { server, queries } = loadDetail()
  await server.getAdminMemberDetail(owner, MEMBER)
  const profileQuery = queries.find((query) => query.table === 'profiles')
  assert.equal(profileQuery.client, 'admin')
  // 12번: withdrawn_at 은 정지·메모 구역(탈퇴 회원이면 지워짐 표시)과 버튼 숨김 판정에 쓴다.
  assert.deepEqual(op(profileQuery.ops, 'select'), ['select', 'id, email, display_tag, phone, created_at, provider, is_admin, withdrawn_at'])
  assert.deepEqual(op(profileQuery.ops, 'eq'), ['eq', 'id', MEMBER])
  assert.equal(queries.filter((query) => query.table === 'profiles').length, 1)

  assert.doesNotMatch(lib, /birthdate|address|kakao|gender|avatar|organization|admin_role|price|select\('\*'|\*,/)
  for (const { ops } of queries) {
    assert.doesNotMatch(op(ops, 'select')[1], /\*|profiles/)
  }
  const ticketColumns = op(queries.find((query) => query.table === 'support_tickets').ops, 'select')[1]
  assert.equal(ticketColumns, 'id, subject, status, created_at, responded_at, is_deleted_by_user')
  // 적어 둔 FK 이름이 생성된 타입의 관계 이름과 맞는다.
  const types = read('src/types/supabase.ts')
  const fks = [...lib.matchAll(/!(\w+_fkey)\(/g)].map((match) => match[1])
  assert.equal(fks.length, 5)
  for (const fk of fks) assert.ok(types.includes(`foreignKeyName: "${fk}"`), fk)
})

test('대표: 모든 구역을 그 회원 조건으로 읽고, 결제 표는 결제용 클라이언트로 읽는다', async () => {
  const { server, queries, calls } = loadDetail()
  const detail = await server.getAdminMemberDetail(owner, MEMBER)

  assert.deepEqual(tables(queries), ['credit_sources', 'credit_transactions', 'market_refund_requests', 'profiles', 'refund_requests', 'support_tickets'])
  for (const { table, client, ops } of queries.filter((query) => query.table !== 'profiles')) {
    assert.deepEqual(ops.filter(([name]) => name === 'eq'), [['eq', 'user_id', MEMBER]], table)
    assert.equal(client, table === 'refund_requests' ? 'payment' : 'admin', table)
    assert.ok(op(ops, 'limit'), table)
  }
  // 약관 동의 기록(4번 묶음)은 members.view 로 읽는 구역이다.
  assert.deepEqual(calls.sort(), [['balance', MEMBER], ['consents', MEMBER], ['market', { userId: MEMBER }], ['notes', MEMBER, null], ['payments', { userId: MEMBER }], ['suspension', MEMBER, null]])
  assert.deepEqual(op(queries.find((query) => query.table === 'credit_transactions').ops, 'limit'), ['limit', 50])

  assert.equal(detail.profile.email, 'member@example.com')
  for (const key of ['credits', 'creditTransactions', 'paymentOrders', 'marketOrders', 'paymentRefunds', 'marketRefunds', 'supportTickets', 'withdrawal', 'suspension', 'notes']) {
    assert.equal(detail[key].failed, false, key)
  }
  // 쓸 수 있는 잔액은 get_credit_balance_snapshot의 값 그대로다.
  assert.equal(detail.credits.data.spendableBalance, 120)
  assert.equal(detail.credits.data.databaseNow, snapshot.databaseNow)
  // 주문은 최근 10건만 보이고 전체 건수는 따로 알린다.
  assert.equal(detail.paymentOrders.data.orders.length, 10)
  assert.equal(detail.paymentOrders.data.totalCount, 12)
  // 다운로드 기록이 잘렸다는 사실을 버리지 않고, 화면은 주문 조회와 같은 문구로 알리며 '없음'으로 단정하지 않는다.
  assert.equal(detail.marketOrders.data.downloadsTruncated, true)
  assert.ok(page.includes("order.downloads.count === 0 && !downloadsTruncated"))
  assert.ok(page.includes("downloadsTruncated ? ' 이상 (기록이 많아 최근 것만 읽었습니다)' : ''"))
  assert.ok(read('src/app/(admin)/admin/orders/market-orders-client.tsx').includes("' 이상 (기록이 많아 최근 것만 읽었습니다)'"))
  // 테스트 결제는 주문 조회와 같은 배지로 구분한다.
  assert.ok(page.includes("{order.environment !== 'live' && <Badge variant=\"outline\">{labelOf(PAYMENT_ENVIRONMENT_LABELS, order.environment)}</Badge>}"))
})

test('권한이 없는 구역은 조회 자체를 하지 않는다', async () => {
  const cases = [
    // 12번: '이용 정지'·'관리자 메모' 구역은 members.view 로 읽는다(그 안의 기한·잔액·대기 건수는 읽는 함수가 권한을 다시 본다).
    { access: staff('members.view'), tables: ['profiles'], calls: ['consents', 'notes', 'suspension'], sections: ['consents', 'suspension', 'notes'] },
    { access: staff('members.view', 'orders.view'), tables: ['market_refund_requests', 'profiles', 'refund_requests'], calls: ['consents', 'market', 'notes', 'payments', 'suspension'], sections: ['paymentOrders', 'marketOrders', 'paymentRefunds', 'marketRefunds', 'consents', 'suspension', 'notes'] },
    { access: staff('members.view', 'credits.view'), tables: ['credit_sources', 'credit_transactions', 'profiles'], calls: ['balance', 'consents', 'notes', 'suspension'], sections: ['credits', 'creditTransactions', 'consents', 'suspension', 'notes'] },
    { access: staff('members.view', 'support.manage'), tables: ['profiles', 'support_tickets'], calls: ['consents', 'notes', 'suspension'], sections: ['supportTickets', 'consents', 'suspension', 'notes'] },
    // 환불 처리 권한만 있고 함께 필요한 orders.view가 없으면 환불 구역도 읽지 않는다.
    { access: staff('members.view', 'refunds.market'), tables: ['profiles'], calls: ['consents', 'notes', 'suspension'], sections: ['consents', 'suspension', 'notes'] },
  ]
  for (const expected of cases) {
    const { server, queries, calls } = loadDetail()
    const detail = await server.getAdminMemberDetail(expected.access, MEMBER)
    const label = Object.keys(expected.access.grants).join(',')
    assert.deepEqual(tables(queries), expected.tables, label)
    assert.deepEqual(calls.map(([name]) => name).sort(), expected.calls, label)
    for (const key of ['credits', 'creditTransactions', 'paymentOrders', 'marketOrders', 'paymentRefunds', 'marketRefunds', 'supportTickets', 'consents', 'withdrawal', 'suspension', 'notes']) {
      assert.equal(detail[key] !== null, expected.sections.includes(key), `${label} ${key}`)
    }
  }
  // 화면은 읽지 않은 구역(null)을 그리지 않는다. 10번 '회원 탈퇴' 구역은 대표만(staff 는 null).
  assert.match(page, /if \(!section\) return null/)
  assert.equal(page.match(/<Section\s/g).length, 11)
})

test('구역 실패 격리: 실패한 구역만 failed이고 나머지는 정상이며, "없음"과 구분된다', async () => {
  const refundsDown = loadDetail({ tableErrors: ['market_refund_requests'] })
  const detail = await refundsDown.server.getAdminMemberDetail(owner, MEMBER)
  assert.deepEqual(detail.marketRefunds, { failed: true })
  assert.deepEqual(detail.paymentRefunds, { failed: false, data: { requests: [], totalCount: 0 } })
  assert.deepEqual(detail.supportTickets, { failed: false, data: { tickets: [], withdrawn: false, totalCount: 0 } })
  assert.equal(detail.credits.failed, false)
  assert.equal(refundsDown.errors.length, 1)

  // 잔액 RPC가 실패하면 크레딧 구역만 실패하고 거래 구역은 보인다.
  const balanceDown = loadDetail({ snapshotError: true, rowsByTable: { credit_transactions: [{ id: 't1', type: 'purchase', amount: 100, balance_after: 100, description: null, created_at: '2026-11-10T00:00:00Z', source: { source_category: 'admin_grant' } }] } })
  const partial = await balanceDown.server.getAdminMemberDetail(owner, MEMBER)
  assert.deepEqual(partial.credits, { failed: true })
  assert.equal(partial.creditTransactions.data[0].source_category, 'admin_grant')
  assert.equal(partial.paymentOrders.failed, false)

  assert.match(page, /section\.failed \? \(\s*<p role="alert"[^>]*>불러오지 못했습니다\./)
  assert.match(page, /<Empty>충전 결제가 없습니다\.<\/Empty>/)
})

test('충전 환불 금액: 부분취소 건의 완료 전 금액은 환불 관리와 같은 기준으로 "신청 기준액"이라 알린다', async () => {
  const refund = (extra) => ({
    id: 'r', status: 'manual_review', origin: 'user', refund_amount: 10000, reason: null, last_error_code: null,
    created_at: '2026-11-10T00:00:00Z', processed_at: null,
    order: { order_id: 'ORD-1', plan_name_snapshot: '기본', transaction: { cancel_feedback_recorded_at: null, partial_cancel_feedback_recorded_at: null } },
    ...extra,
  })
  const { server } = loadDetail({ rowsByTable: { refund_requests: [
    refund({ id: 'r1', origin: 'partial_cancel' }),
    refund({ id: 'r2', origin: 'partial_cancel', status: 'completed' }),
    refund({ id: 'r3' }),
    refund({ id: 'r4', order: null }),
  ] } })
  const { requests } = (await server.getAdminMemberDetail(owner, MEMBER)).paymentRefunds.data
  assert.deepEqual(requests.map((request) => request.amountIsRequestBasis), [true, false, false, false])
  // 판정에만 쓴 값(오류 코드·결제사 표식)은 화면으로 넘기지 않는다.
  assert.deepEqual(requests[0].order, { order_id: 'ORD-1', plan_name_snapshot: '기본' })
  assert.equal('last_error_code' in requests[0], false)
  // 금액이 정해지지 않은 건에는 붙이지 않는다("환불액 미정 신청 기준액"이 되지 않게).
  assert.match(page, /request\.amountIsRequestBasis && request\.refund_amount != null && <span[^>]*>신청 기준액<\/span>/)
  assert.match(read('src/app/(admin)/admin/refunds/refunds-client.tsx'), /requiresRecovery\(request\) && request\.status !== 'completed' && \(\s*<p[^>]*>신청 기준액<\/p>/)
})

test('없는 회원·uuid가 아닌 값은 null이고(구역을 읽지 않음), 기본 정보 조회 실패는 예외다', async () => {
  const invalid = loadDetail()
  assert.equal(await invalid.server.getAdminMemberDetail(owner, "1' or 1=1"), null)
  assert.equal(invalid.queries.length + invalid.calls.length, 0)

  const missing = loadDetail({ profileRow: null })
  assert.equal(await missing.server.getAdminMemberDetail(owner, MEMBER), null)
  assert.deepEqual(tables(missing.queries), ['profiles'])
  assert.equal(missing.calls.length, 0)

  const failed = loadDetail({ profileError: 'boom' })
  await assert.rejects(failed.server.getAdminMemberDetail(owner, MEMBER), /boom/)
})

test('회원 삭제 문의도 읽고(삭제 표시), 상태 이름표는 주문 조회의 것을 다시 쓴다', async () => {
  const { server, queries } = loadDetail({ rowsByTable: { support_tickets: [{ id: 's1', subject: '문의', status: 'pending', created_at: '2026-11-10T00:00:00Z', responded_at: null, is_deleted_by_user: true }] } })
  const detail = await server.getAdminMemberDetail(owner, MEMBER)
  assert.equal(detail.supportTickets.data.tickets[0].is_deleted_by_user, true)
  assert.equal(queries.find((query) => query.table === 'support_tickets').ops.some(([name, column]) => name === 'eq' && column === 'is_deleted_by_user'), false)
  assert.match(page, /ticket\.is_deleted_by_user && <Badge[^>]*>회원이 삭제함<\/Badge>/)
  // 문의별 링크는 제목 검색이 아니라(쉼표·괄호·같은 제목에서 깨진다) 문의 id로 그 문의를 바로 연다.
  assert.doesNotMatch(page, /\/admin\/support\?q=|ticket\.subject\)/)
  assert.ok(page.includes('<Link href={`/admin/support?ticket=${ticket.id}`}'))
  assert.match(page, /link=\{\{ href: '\/admin\/support', label: '문의 관리' \}\}/)

  for (const name of ['PAYMENT_ORDER_STATUS_LABELS', 'MARKET_ORDER_STATUS_LABELS', 'REFUND_REQUEST_STATUS_LABELS', 'MARKET_REFUND_REQUEST_STATUS_LABELS', 'CREDIT_SOURCE_STATUS_LABELS', 'MARKET_DOWNLOAD_BLOCK_REASON_LABELS']) {
    assert.match(page, new RegExp(`labelOf\\(${name}, `), name)
  }
  assert.match(page, /getAdminCreditTransactionKind\(transaction\)/)
  assert.match(page, /formatMemberDisplayName\(profile\.email, profile\.display_tag\)/)
  for (const label of [...Object.values(orders.PAYMENT_ORDER_STATUS_LABELS), ...Object.values(orders.MARKET_REFUND_REQUEST_STATUS_LABELS)]) {
    assert.ok(!page.includes(`'${label}'`), label)
  }
})

test('주문 조회 함수의 회원 조건: userId를 주면 건수·목록 모두 그 회원으로 좁히고, 주지 않으면 그대로다', async () => {
  const run = async (input) => {
    const queries = []
    const { client: admin } = createFakeAdmin(({ table, ops }) => {
      queries.push({ table, ops })
      if (op(ops, 'select')[2]?.head) return { count: table === 'payment_orders' ? 1 : 0, error: null }
      if (table === 'payment_orders') {
        return { data: [{ id: 'o1', order_id: 'ORD-1', user_id: MEMBER, user: null, method: null, transaction: null, source: null, refunds: [] }], error: null }
      }
      return { data: [], error: null }
    })
    const server = load('src/lib/admin-orders-server.ts', {
      '@/lib/payment-orders-server': { createPaymentAdminClient: () => admin },
      '@/lib/admin-accounts-shared': load('src/lib/admin-accounts-shared.ts'),
      '@/lib/kst-period': load('src/lib/kst-period.ts'),
      '@/lib/list-pagination': load('src/lib/list-pagination.ts'),
      '@/lib/admin-orders': orders,
      '@/lib/supabase/bypass': { createAdminClient: () => admin },
      '@/lib/market-download-diagnosis': {},
      // 10번: 탈퇴 회원 표시(이 시험의 회원은 탈퇴하지 않음)
      '@/lib/withdrawn-member-redaction-server': { readWithdrawnUserIdsForRedaction: async () => new Set() },
    })
    const payments = await server.listPaymentOrdersForAdmin(input)
    await server.listMarketOrdersForAdmin(input)
    return { payments, queries }
  }
  const userEq = (queries, table) => queries.filter((query) => query.table === table).map(({ ops }) => ops.filter(([name, column]) => name === 'eq' && column === 'user_id'))

  const scoped = await run({ userId: MEMBER })
  assert.deepEqual(userEq(scoped.queries, 'payment_orders'), [[['eq', 'user_id', MEMBER]], [['eq', 'user_id', MEMBER]]])
  assert.deepEqual(userEq(scoped.queries, 'market_purchase_orders'), [[['eq', 'user_id', MEMBER]]])
  // 진입 링크용으로 주문에 회원 id를 싣는다.
  assert.equal(scoped.payments.orders[0].userId, MEMBER)

  const all = await run({})
  assert.deepEqual(userEq(all.queries, 'payment_orders'), [[], []])
  assert.deepEqual(userEq(all.queries, 'market_purchase_orders'), [[]])

  const source = read('src/lib/admin-orders-server.ts')
  assert.equal(source.match(/countQuery = countQuery\.eq\('user_id', input\.userId\)\s*dataQuery = dataQuery\.eq\('user_id', input\.userId\)/g).length, 2)
  // 조회 API는 주소의 값으로 이 조건을 받지 않는다(회원 상세만 쓴다). 13번: 응답 행의 order.userId 는 열람 기록에만 쓴다.
  for (const route of ['src/app/api/admin/orders/payments/route.ts', 'src/app/api/admin/orders/market/route.ts']) {
    assert.doesNotMatch(read(route), /userId:|get\('userId'\)/, route)
  }
})

test('진입 링크: 회원을 보여 주는 관리자 화면에서 회원 상세로 간다', () => {
  const links = {
    'users/users-client.tsx': '`/admin/users/${user.id}`',
    'orders/orders-client.tsx': '`/admin/users/${order.userId}`',
    'orders/market-orders-client.tsx': '`/admin/users/${order.userId}`',
    'refunds/refunds-client.tsx': '`/admin/users/${request.user_id}`',
    'refunds/market-refunds-client.tsx': '`/admin/users/${request.user_id}`',
    'support/support-client.tsx': '`/admin/users/${selectedTicket.user_id}`',
  }
  for (const [file, href] of Object.entries(links)) {
    assert.ok(read(`src/app/(admin)/admin/${file}`).includes(`<Link href={${href}}`), file)
  }
  // 회원 상세의 '전체 보기'는 주문 조회·크레딧 관리를 그 회원 이메일로 검색한 상태로 연다.
  assert.match(page, /`\/admin\/orders\?tab=payments&q=\$\{emailQuery\}`/)
  assert.match(page, /`\/admin\/orders\?tab=market&q=\$\{emailQuery\}`/)
  assert.match(page, /`\/admin\/credits\?q=\$\{emailQuery\}`/)
})

test('12번: 정지·메모 버튼은 화면·route·DB 가 같은 권한일 때만 보이고, 분류별 기본값·회원 문구를 코드에 두지 않는다', () => {
  // 화면: 이용 제한·해제·알림 기록 members.suspend(관리자·본인 계정 제외), 로그인 차단·가림은 대표, 메모 추가 members.memo
  assert.match(page, /canSuspend: isMemberTarget && hasAdminPermission\(access, 'members\.suspend'\)/)
  assert.match(page, /const isOwner = hasAdminPermission\(access, 'owner'\)/)
  assert.match(page, /canMemo: !profile\.is_admin && hasAdminPermission\(access, 'members\.memo'\)/)
  assert.match(page, /익명화하면 정지 기록 \{erasedSuspensionCount\}건·메모 \{erasedNoteCount\}건이 지워집니다\. 개인정보처리방침 3절에 따라 따로 보관하지 않습니다\./)
  const panel = read('src/app/(admin)/admin/users/[id]/member-suspension-panel.tsx')
  const notes = read('src/app/(admin)/admin/users/[id]/member-notes-panel.tsx')
  // 로그인 차단 범위는 대표에게만 보이고, 활성 로그인 차단의 해제·알림 기록도 대표만
  assert.match(panel, /\.filter\(\(value\) => value === 'restricted' \|\| isOwner\)/)
  assert.match(panel, /capabilities\.canSuspend && \(active\.scope === 'restricted' \|\| capabilities\.isOwner\)/)
  // 다운로드도 막기의 미리 체크는 분류 데이터(blocksDownloadDefault), 만 14세 미만 안내도 분류 데이터(underageGuide)
  assert.match(panel, /\?\.blocksDownloadDefault \?\? false/)
  assert.match(panel, /category\?\.underageGuide && <Warning>\{texts\.adminUnderageGuide\}<\/Warning>/)
  for (const code of ['account_misuse', 'material_sharing', 'scraping', 'payment_abuse', 'operation_interference', 'underage\'', 'other\'']) {
    assert.ok(!panel.includes(code) && !notes.includes(code), code)
  }
  // 회원 화면 문구·관리자 안내 문구는 정책 texts 로 읽는다.
  for (const key of ['adminSuspendConfirm', 'adminDeadlineWarning', 'ownerMailDeadlines', 'noticeBlockedList', 'noticeAvailableList']) {
    assert.ok(panel.includes(`texts.${key}`), key)
  }
  assert.match(notes, /canDelete = !note\.deleted_at && \(capabilities\.isOwner \|\| \(capabilities\.canMemo && note\.created_by === capabilities\.actorId\)\)/)
  assert.match(notes, /canRedact = capabilities\.isOwner && !note\.redacted_at/)
  // 정지 창은 열 때마다 새 operation_key 를 만든다(응답 유실 뒤 다시 눌러도 한 번만).
  assert.match(panel, /setOperationKey\(crypto\.randomUUID\(\)\)/)
})
