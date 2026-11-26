import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fullRpc, loadDashboardServer, owner, resolve, staff } from './helpers/admin-dashboard-harness.mjs'

// 운영 개선 계획 U2-2(대시보드 지표)의 계약. 21번 묶음(docs/plan-bundle21-dashboard.md)에서 기대값을 바꿨다:
// - 집계는 표를 끝까지 나눠 읽어 더하던 방식 대신 DB 보고 함수(23번 report_charge_daily, 21번 report_* 3개)가 한다 → 1000행 나눠 읽기 시험은 뺐다.
// - 충전 숫자는 23번 정의(실결제 payapp live, 승인 시각 / 환불은 COALESCE(결제사 취소 시각, 처리 시각))로 바뀌었다(Q5).
// - 마켓 판매는 '지금 유효한 구매만' 대신 주문 표 기준 순 사용 C(Q6), 원·C 는 reports.view 로 옮겼다(Q2 기본안).
// - 최근 목록은 기간과 따로 탭마다 읽고(최근 자료 구매·최근 충전 주문·답변 대기 문의), 이메일은 attachMemberContacts 로 붙인다.
// 권한별 허용 필드·실패 격리·데이터 읽는 길의 자세한 시험은 bundle21-dashboard-contract.test.mjs.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const lib = read('src/lib/admin-dashboard-server.ts')
const route = read('src/app/api/admin/stats/route.ts')
const page = read('src/app/(admin)/admin/page.tsx')
const dashboard = read('src/app/(admin)/admin/dashboard-client.tsx')
const migration23 = read('supabase/migrations/20261222100000_bundle23_sales_report.sql')

test('충전 숫자는 23번 report_charge_daily 정의 그대로: 실결제(payapp live)만, 결제는 승인 시각, 환불은 결제사 취소 시각(없으면 처리 시각)', async () => {
  assert.match(lib, /callReport<ChargeDaily>\('report_charge_daily', current\)/)
  assert.match(migration23, /WHERE po\.provider = 'payapp' AND po\.provider_environment = 'live' AND po\.status IN \('completed', 'refunded'\)\s*AND po\.approved_at IS NOT NULL AND po\.approved_at >= p_from AND po\.approved_at < p_to/)
  assert.match(migration23, /COALESCE\(rr\.provider_cancelled_at, rr\.processed_at\) >= p_from/)
  // 순 충전 매출 = 결제 − 환불
  const { server } = loadDashboardServer({ rpc: fullRpc() })
  const data = await server.getAdminDashboard(owner, resolve(), { includeProducts: false })
  assert.equal(data.charge.data.current.net, data.charge.data.current.paymentAmount - data.charge.data.current.refundAmount)
})

test('항목 하나가 실패하면 그 항목만 확인 불가이고 나머지는 그대로다', async () => {
  const { server, errors } = loadDashboardServer({ rpc: { ...fullRpc(), report_market_daily: { error: { message: 'boom' } } } })
  const data = await server.getAdminDashboard(owner, resolve(), { includeProducts: false })
  assert.deepEqual(data.market, { failed: true })
  assert.equal(data.charge.failed, false)
  assert.equal(data.activity.failed, false)
  assert.equal(data.downloadRanking.failed, false)
  assert.equal(errors.length, 2, '지금·앞 기간 두 번 실패를 남긴다')
})

test('권한: 없는 구역은 조회 자체를 하지 않는다(문의 권한만이면 숫자 함수를 부르지 않음)', async () => {
  const support = loadDashboardServer({ rpc: fullRpc() })
  const data = await support.server.getAdminDashboard(staff('support.manage'), resolve(), { includeProducts: true })
  assert.equal(support.calls.rpc.length, 0)
  assert.equal(support.calls.queries.length, 0)
  for (const key of ['charge', 'market', 'activity', 'orderRanking', 'downloadRanking', 'products']) assert.equal(data[key], null, key)
})

test('조회 전용이고, 결제 lib 은 읽기 클라이언트만 가져다 쓴다', () => {
  assert.doesNotMatch(lib, /\.(insert|update|upsert|delete)\(/)
  assert.deepEqual([...new Set([...lib.matchAll(/callReport<[^>]*>\('(\w+)'/g)].map((match) => match[1]))].sort(),
    ['report_activity_daily', 'report_charge_daily', 'report_market_daily', 'report_market_item_ranking'])
  assert.doesNotMatch(lib, /from '@\/lib\/(market-items-server|market-purchase|credits)'/)
})

test('통계 API: 관리자 확인 뒤에 계정 권한으로 지표를 읽는다(가입 수도 DB 함수가 센다)', () => {
  assert.match(route, /const guard = await requireAdminApiPermission\('admin'\)\s*if \('error' in guard && guard\.status !== 500\)/)
  assert.match(route, /const access = 'error' in guard \? null : guard\.access/)
  assert.ok(route.indexOf('profile?.is_admin') > 0 && route.indexOf('profile?.is_admin') < route.indexOf('getAdminDashboard('))
  assert.doesNotMatch(route, /countSignups|createAdminClient/)
  assert.doesNotMatch(lib, /from\('profiles'\)/)
})

test('화면 순서: 제목줄 → 상태 바(처리 대기·판매 상태·슬랙) → 카드 → 그래프 → 상품 → 최근 목록', () => {
  assert.match(page, /await requireAdminPanelUser\(\)\s*const \[salesStatus, access\] = await Promise\.all\(\[\s*getPaymentSalesStatus\(\),/)
  const body = dashboard.slice(dashboard.indexOf('<AdminPageHeader'))
  const positions = ['<AdminPageHeader', 'workItems.map(', '관리자 알림(슬랙)', '{salesPanel}', 'aria-label="지표"', 'aria-label="추이"', 'aria-label="상품 순위"', 'aria-label="최근 목록"']
    .map((mark) => body.indexOf(mark))
  assert.ok(positions.every((position) => position >= 0), JSON.stringify(positions))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  // 전송 상태는 알림 패널과 같은 값·같은 문구를 쓴다(따로 조회하지 않는다).
  assert.match(dashboard, /dispatchStatusMessages\(alerts\.summary\.dispatch\)/)
  // 통계 route 는 기간·과목을 바꿀 때 한 곳에서만 부른다(최근 목록은 따로 한 곳).
  assert.equal(dashboard.match(/fetch\(/g).length, 2)
})

test('화면: 권한 없는 구역은 그리지 않고, 못 센 값은 확인 불가, 링크는 지금 주소 형식', () => {
  assert.match(dashboard, /if \(permissions\.money\) \{/)
  assert.match(dashboard, /if \(permissions\.orders\) \{/)
  assert.match(dashboard, /if \(permissions\.members\) \{/)
  assert.match(dashboard, /\{recentTab \? \(/)
  assert.match(dashboard, /valueUnavailable=\{!charge\}/)
  assert.match(dashboard, /목록을 불러오지 못했습니다/)
  assert.match(dashboard, /href=\{`\/admin\/support\?ticket=\$\{ticket\.id\}`\}/)
  assert.match(dashboard, /href=\{`\/admin\/orders\?q=\$\{encodeURIComponent\(order\.order_id\)\}`\}/)
  assert.match(dashboard, /href=\{`\/admin\/orders\?tab=market&q=\$\{encodeURIComponent\(order\.id\)\}`\}/)
  // 좁은 화면: 최근 목록은 표가 아니라 줄 목록이다.
  const recent = dashboard.slice(dashboard.indexOf('function RecentList'))
  assert.doesNotMatch(recent, /<AdminDataTable|<table/)
})
