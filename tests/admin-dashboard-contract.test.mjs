import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const route = read('src/app/api/admin/stats/route.ts')
const summary = read('src/lib/admin-work-summary-server.ts')
const dashboard = read('src/app/(admin)/admin/dashboard-client.tsx')
const workItems = read('src/lib/admin-alerts.ts')

test('통계 API는 없는 표·옛 문제 표·서버 시간대에 기대지 않는다', () => {
  assert.doesNotMatch(route, /admin_logs/)
  assert.doesNotMatch(route, /\.sum\(\)/)
  assert.doesNotMatch(route, /from\('questions'\)/)
  assert.doesNotMatch(route, /setHours/)
  // 21번: 기간은 주소(period·subject·from·to)로 정하고 한국 시간으로 계산한다(오늘·이번 달 고정 대신).
  assert.match(route, /resolveDashboardPeriod\(parseDashboardQuery\(url\.searchParams, now\), now\)/)
  // 처리 대기는 그 계정의 권한(access)에 맞는 항목만 센다.
  assert.match(route, /getAdminWorkSummary\(access\)/)
  // 관리자 확인이 집계보다 먼저다(집계는 service role을 쓴다).
  assert.ok(route.indexOf('profile?.is_admin') < route.indexOf('getAdminWorkSummary(access)'))
})

test('처리 대기 집계: 결제 쪽 표는 service role로, 실패한 항목은 null로', () => {
  for (const table of ['refund_requests', 'payment_orders', 'payment_reconciliation_alerts']) {
    assert.match(summary, new RegExp(`createPaymentAdminClient\\(\\)\\s*\\.from\\('${table}'\\)`))
  }
  assert.match(summary, /\.from\('support_tickets'\)[\s\S]*?\.eq\('status', 'pending'\)\s*\.eq\('is_deleted_by_user', false\)/)
  assert.match(summary, /\.from\('market_refund_requests'\)[\s\S]*?\.eq\('status', 'pending'\)/)
  assert.match(summary, /if \(error \|\| count === null\) \{[\s\S]*?return null/)
  assert.match(summary, /catch \(error\) \{[\s\S]*?return null/)
})

test('대시보드는 거짓 표시를 하지 않고, 세지 못한 값을 0으로 보이지 않는다', () => {
  assert.doesNotMatch(dashboard, /정상 작동 중/)
  assert.doesNotMatch(dashboard, /\/admin\/questions/)
  assert.doesNotMatch(dashboard, /학년 TOP 5/)
  assert.doesNotMatch(dashboard, /총 매출|AI 문제 생성|에러\/실패 로그/)
  assert.match(dashboard, /value === null \? '확인 불가'/)
  // 21번: 제목줄 보조 줄 '마지막 갱신 15:12 · 한국 시간 기준'
  assert.match(dashboard, /마지막 갱신 \{formatKstTime\(generatedAt\)\} · 한국 시간 기준/)
  // 처리 대기 항목(이름·이동할 화면)은 알림과 같이 쓰는 목록에 있다.
  assert.match(dashboard, /const workItems = visibleWorkItems\(work\)/)
  assert.match(dashboard, /workItems\.map\(/)
  assert.match(workItems, /\/admin\/support/)
  assert.match(workItems, /\/admin\/refunds/)
})
