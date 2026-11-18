import assert from 'node:assert/strict'
import test from 'node:test'
import { load } from './helpers/market-images-harness.mjs'

// 처리 대기 건수(대시보드·종·메뉴 배지)는 항목별 권한이 있는 계정에만 센다. 권한이 없는 항목은 요약에서 빠진다.
const permissions = load('src/lib/admin-permissions.ts')
const alerts = load('src/lib/admin-alerts.ts')
const USER_ID = '00000000-0000-4000-8000-000000000001'
const grant = (permission) => ({ permission, limits: {} })
const staff = (...keys) => permissions.buildAdminAccess(USER_ID, { is_admin: true, admin_role: 'staff' }, keys.map(grant))
const owner = permissions.buildAdminAccess(USER_ID, { is_admin: true, admin_role: 'owner' }, [])

function loadSummary() {
  const queried = []
  const builder = (table) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      is: () => query,
      then: (resolve, reject) => Promise.resolve({ count: 2, error: null }).then(resolve, reject),
    }
    queried.push(table)
    return query
  }
  const server = load('src/lib/admin-work-summary-server.ts', {
    '@/lib/supabase/server': { createClient: async () => ({ from: builder }) },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => ({ from: builder }) },
    '@/lib/admin-alerts': alerts,
    '@/lib/admin-permissions': permissions,
  })
  return { summarize: server.getAdminWorkSummary, queried }
}

test('항목별 권한: 대표는 전부, 직원은 받은 권한의 항목만 세고 나머지는 키째 빠진다', async () => {
  const all = { supportPending: 2, marketRefundPending: 2, refundPending: 2, refundAttention: 2, paymentOrderReview: 2, paymentAlertOpen: 2 }
  assert.deepEqual(await loadSummary().summarize(owner), all)

  const cs = loadSummary()
  assert.deepEqual(await cs.summarize(staff('support.manage')), { supportPending: 2 })
  assert.deepEqual(cs.queried, ['support_tickets'], '권한 없는 항목은 조회하지도 않는다')

  assert.deepEqual(await loadSummary().summarize(staff('orders.view', 'refunds.market')), { marketRefundPending: 2 })
  assert.deepEqual(await loadSummary().summarize(staff('orders.view', 'refunds.payment')), { refundPending: 2, refundAttention: 2, paymentOrderReview: 2, paymentAlertOpen: 2 })
  // 의존 권한이 빠지면 없는 것으로 본다.
  assert.deepEqual(await loadSummary().summarize(staff('refunds.market')), {})
  assert.deepEqual(await loadSummary().summarize(staff()), {})
})

test('권한을 읽지 못하면(access null) 세지 않고 모든 항목이 "확인 불가"(null)', async () => {
  const unknown = loadSummary()
  const work = await unknown.summarize(null)
  assert.deepEqual(Object.keys(work).sort(), alerts.ADMIN_WORK_ITEMS.map((item) => item.key).sort())
  assert.ok(Object.values(work).every((value) => value === null))
  assert.deepEqual(unknown.queried, [])
})

test('화면 규칙: 빠진 항목은 그리지 않고, 합계·메뉴 배지에서도 뺀다', () => {
  const work = { supportPending: 3 }
  assert.deepEqual(alerts.visibleWorkItems(work).map((item) => item.key), ['supportPending'])
  assert.equal(alerts.workTotal(work), 3)
  assert.equal(alerts.menuBadgeCount('/admin/support', work), 3)
  assert.equal(alerts.menuBadgeCount('/admin/refunds', work), undefined, '권한이 없는 메뉴에는 배지가 없다')
  // 환불 메뉴에서 일부 항목만 보이는 직원(마켓 환불 권한만): 그 항목만 더하고, 못 셌으면 null
  assert.equal(alerts.menuBadgeCount('/admin/refunds', { marketRefundPending: 1 }), 1)
  assert.equal(alerts.menuBadgeCount('/admin/refunds', { marketRefundPending: null }), null)
  assert.equal(alerts.workTotal({}), 0)
  assert.deepEqual(alerts.visibleWorkItems({}), [])
  // 요약 조회 실패(null)는 전과 같이 모든 항목 "확인 불가"
  assert.equal(alerts.visibleWorkItems(null).length, alerts.ADMIN_WORK_ITEMS.length)
  assert.equal(alerts.workTotal(null), null)
  assert.equal(alerts.menuBadgeCount('/admin/refunds', null), null)
  // 보이는 항목 중 하나라도 못 셌으면 합계는 null
  assert.equal(alerts.workTotal({ supportPending: 1, marketRefundPending: null }), null)
  // 모든 항목의 권한은 목록에 있는 권한이다.
  for (const item of alerts.ADMIN_WORK_ITEMS) assert.ok(permissions.ADMIN_PERMISSION_KEYS.includes(item.requirement), item.key)
})
