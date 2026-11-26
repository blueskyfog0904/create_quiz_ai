import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'
import { buildRehearsalFiles, LIGHT_FORBIDDEN, NOVEMBER_EXAMPLE } from '../supabase/scripts/bundle23_rehearsal/generate.mjs'

// 23번 묶음(매출·정산 CSV, 계획 docs/plan-bundle23-sales-csv.md 9절): 순수 규칙 + 계약.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const report = load('src/lib/sales-report.ts', {
  '@/lib/admin-orders': load('src/lib/admin-orders.ts'),
  '@/lib/kst-period': load('src/lib/kst-period.ts'),
})
const MIGRATION = read('supabase/migrations/20261222100000_bundle23_sales_report.sql')
const DOWN = read('supabase/rollback/20261222100000_bundle23_sales_report_down.sql')
const ROUTE = read('src/app/api/admin/reports/export/route.ts')
const SERVER = read('src/lib/sales-report-server.ts')
const NOW = new Date('2026-11-27T03:00:00Z') // 2026-11-27 12:00 KST

const content = {
  definitionVersion: 1, revision: 3, fileTitle: '매출·정산 CSV', headerNotice: '-대조용 자료', kstNotice: '한국 시간',
  netNotice: '순액 안내', creditNotice: '참고', withdrawalNotice: '탈퇴', expiryNotice: '만료', usageNotice: '참고 금액', screenGuide: 'RB-10',
}

// ---------------------------------------------------------------------------------------------------------------
// 기간(3-5)
// ---------------------------------------------------------------------------------------------------------------
test('기간: 달·날짜·윤년·연말·366일·미래는 오늘까지', () => {
  assert.deepEqual(report.salesReportMonthRange(NOW, 0), { from: '2026-11-01', to: '2026-11-27' })
  assert.deepEqual(report.salesReportMonthRange(NOW, -1), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(report.salesReportMonthRange(new Date('2027-01-05T00:00:00Z'), -1), { from: '2026-12-01', to: '2026-12-31' }, '연말 넘김')
  assert.deepEqual(report.salesReportMonthRange(new Date('2028-03-10T00:00:00Z'), -1), { from: '2028-02-01', to: '2028-02-29' }, '윤년 2월')

  const nov = report.resolveSalesReportPeriod({ from: '2026-11-01', to: '2026-11-30' }, NOW)
  assert.equal(nov.ok, true)
  assert.equal(nov.period.toDate, '2026-11-27', '미래는 오늘까지')
  assert.equal(nov.period.fromIso, '2026-10-31T15:00:00.000Z', '시작 00:00 KST')
  assert.equal(nov.period.toIso, '2026-11-27T15:00:00.000Z', '끝 다음 날 00:00 KST')

  const leap = report.resolveSalesReportPeriod({ from: '2028-01-01', to: '2028-12-31' }, new Date('2029-01-02T00:00:00Z'))
  assert.equal(leap.ok, true)
  assert.equal(leap.period.days, 366, '윤년 한 해 366일 허용')
  assert.equal(report.resolveSalesReportPeriod({ from: '2025-11-26', to: '2026-11-27' }, NOW).ok, false, '367일 거절')
  assert.equal(report.resolveSalesReportPeriod({ from: '2025-11-27', to: '2026-11-27' }, NOW).period.days, 366)
  assert.equal(report.resolveSalesReportPeriod({ from: '2026-11-28', to: '2026-11-30' }, NOW).ok, false, '시작이 미래')
  assert.equal(report.resolveSalesReportPeriod({ from: '2026-11-10', to: '2026-11-01' }, NOW).ok, false, '거꾸로')
  assert.equal(report.resolveSalesReportPeriod({ from: '2026-02-30', to: '2026-03-01' }, NOW).ok, false, '없는 날짜')
  assert.equal(report.resolveSalesReportPeriod({ from: null, to: '2026-03-01' }, NOW).ok, false)
})

// ---------------------------------------------------------------------------------------------------------------
// CSV(Q7·5-1)
// ---------------------------------------------------------------------------------------------------------------
test('CSV: BOM·\\r\\n·따옴표 감싸기·한국 시각', () => {
  const csv = report.buildCsv(['제목'], [
    { header: '이름', type: 'text', value: (row) => row.name },
    { header: '금액', type: 'integer', value: (row) => row.amount },
    { header: '시각', type: 'datetime', value: (row) => row.at },
  ], [{ name: '쉼표, "따옴표"', amount: 9900, at: '2026-11-30T14:59:59Z' }])
  assert.ok(csv.startsWith('﻿'))
  assert.equal(csv.split('\r\n').length, 5)
  assert.ok(!/[^\r]\n/.test(csv), '줄바꿈은 \\r\\n 만')
  assert.match(csv, /"쉼표, ""따옴표""",9900,2026-11-30 23:59:59\r\n$/)
  assert.throws(() => report.formatCsvCell('integer', 1.5), /CSV_INTEGER_INVALID/)
})

test('수식 주입 막기: 문자열 칸(머리 줄·열 제목·DB 이름) 앞에 \', 숫자 칸 음수는 숫자 그대로', () => {
  assert.equal(report.escapeCsvText('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
  assert.equal(report.escapeCsvText('-대조용'), "'-대조용")
  assert.equal(report.escapeCsvText('+1'), "'+1")
  assert.equal(report.escapeCsvText('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(report.escapeCsvText('\tTAB'), "'\tTAB")
  assert.equal(report.escapeCsvText('\rCR'), `"'\rCR"`)
  assert.equal(report.escapeCsvText('네이버페이'), '네이버페이')
  // 앞쪽 공백·줄바꿈(전각 공백 포함)을 건너뛴 첫 글자, 전각 기호도 막는다
  assert.equal(report.escapeCsvText(' =HYPERLINK("x")'), `"' =HYPERLINK(""x"")"`)
  assert.equal(report.escapeCsvText('\n=1+1'), `"'\n=1+1"`)
  assert.equal(report.escapeCsvText('\u3000=1'), "'\u3000=1")
  assert.equal(report.escapeCsvText('＝SUM(A1)'), "'＝SUM(A1)")
  assert.equal(report.escapeCsvText('＋1'), "'＋1")
  assert.equal(report.escapeCsvText('－1'), "'－1")
  assert.equal(report.escapeCsvText('＠A1'), "'＠A1")
  assert.equal(report.escapeCsvText(' 요금제'), '" 요금제"', '공백 뒤 일반 글은 감싸기만')
  assert.equal(report.formatCsvCell('integer', -1000), '-1000', '음수 순액은 숫자')
  assert.equal(report.formatCsvCell('text', '-1000'), "'-1000", '문자 칸의 - 는 막음')

  const lines = [{ line_kind: 'payment', order_id: 'o1', payment_request_id: 'p1', payment_method_code: 'card', payment_method_label: '=HYPERLINK("evil")',
    plan_name: '+요금제', order_status: 'completed', amount: 1000, vat: 91, supply_amount: 909, paid_at: '2026-11-11T00:00:00Z', refunded_at: null,
    refund_origin: null, external_method: null }]
  const head = report.buildHeadLines({ kind: 'payments', period: report.resolveSalesReportPeriod({ from: '2026-11-01', to: '2026-11-30' }, NOW).period,
    content, generatedAt: NOW, warnings: [] })
  const csv = report.buildCsv(head, report.PAYMENT_COLUMNS, lines)
  assert.ok(csv.includes(`"'=HYPERLINK(""evil"")"`), '결제수단 이름')
  assert.ok(csv.includes("'+요금제"), '요금제 이름')
  assert.ok(csv.includes("\r\n'-대조용 자료\r\n"), "'-' 로 시작하는 DB 머리 문구")
  for (const cell of csv.slice(1).split('\r\n').flatMap((line) => line.split(','))) {
    assert.ok(!/^[=+@]/.test(cell), `수식으로 시작하는 칸 없음: ${cell}`)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// 요약 = 건별 합, 참고 금액 끝수
// ---------------------------------------------------------------------------------------------------------------
const day = (d, extra) => ({ day: d, paymentCount: 0, paymentAmount: 0, paymentVat: 0, refundCount: 0, refundAmount: 0, refundVat: 0,
  manualRefundCount: 0, manualRefundAmount: 0, byMethod: [], byPlan: [], refundByOrigin: [], refundByMethod: [], ...extra })

test('요약 = 건별 합(11월 예시 숫자), 어긋나면 칸 이름', () => {
  const charge = { days: [
    day('2026-11-11', { paymentCount: 2, paymentAmount: 10900, paymentVat: 991, refundCount: 1, refundAmount: 1000, refundVat: 91,
      byMethod: [{ code: 'card', label: '신용·체크카드', count: 2, amount: 10900, vat: 991 }], refundByOrigin: [{ origin: 'user', count: 1, amount: 1000, vat: 91 }] }),
    day('2026-11-20', { paymentCount: 3, paymentAmount: 49700, paymentVat: 4518,
      byMethod: [{ code: 'naverpay', label: '네이버페이', count: 3, amount: 49700, vat: 4518 }] }),
  ], warnings: { manualReviewOrders: 0, cancelPendingOrders: 0, fulfillmentPendingOrders: 0, partialCancelOpen: 0, fullRefundVatMismatch: 0, manualActionsWithoutRefund: 0 } }
  const line = (kind, amount, vat, extra = {}) => ({ line_kind: kind, amount, vat, supply_amount: amount - vat, external_method: null, ...extra })
  const lines = [line('payment', 9900, 900), line('payment', 1000, 91), line('payment', 20000, 1818), line('payment', 19800, 1800), line('payment', 9900, 900),
    line('refund', 1000, 91)]
  const totals = report.sumChargeDays(charge.days)
  assert.equal(totals.paymentAmount, NOVEMBER_EXAMPLE.paymentAmount)
  assert.equal(totals.paymentVat, NOVEMBER_EXAMPLE.paymentVat)
  assert.deepEqual(report.compareChargeTotals(totals, report.sumPaymentLines(lines)), [])
  assert.deepEqual(report.compareChargeTotals(totals, report.sumPaymentLines(lines.slice(1))), ['paymentCount', 'paymentAmount', 'paymentVat'])

  const rows = report.buildSummaryRows(charge)
  const net = rows.find((row) => row.item === '순액(결제 − 환불)')
  assert.deepEqual([net.amount, net.vat, net.supply], [NOVEMBER_EXAMPLE.net, NOVEMBER_EXAMPLE.netVat, 54182])
  assert.equal(rows.filter((row) => row.section === '결제수단별 결제').reduce((sum, row) => sum + row.amount, 0), totals.paymentAmount, '결제수단별 합 = 결제')
  assert.equal(rows.filter((row) => row.section === '일별 결제').reduce((sum, row) => sum + row.amount, 0), totals.paymentAmount, '일별 합 = 결제')
  assert.equal(rows.find((row) => row.section === '환불 경위별').item, '고객 요청')
  assert.deepEqual(report.describeChargeWarnings({ ...charge.warnings, fulfillmentPendingOrders: 2 }),
    ['지급 대기 결제 2건(결제 합계에 아직 들어가지 않음 — 지급되면 결제 시각의 기간에 들어감)'])
  assert.match(functionBody('report_charge_daily'), /'fulfillmentPendingOrders'[\s\S]+?po\.status = 'fulfillment_pending'/)
  assert.match(read('docs/admin-operations-runbook.md'), /지급 대기\(`fulfillment_pending`\) 주문도 아직 들어가지 않습니다/)
})

test('참고 금액: 원 미만 버림·끝수 줄, 순사용 = 총사용 − 환불 차감', () => {
  const usage = {
    gross: { rows: [{ category: 'paid', credits: 363, won: 3593 }, { category: 'admin_grant', credits: 100, won: 0 }], credits: 463, won: 3593, fraction: 0.7 },
    refund: { rows: [{ category: 'paid', credits: 189, won: 1871 }], credits: 189, won: 1871, fraction: 0.1 },
    net: { credits: 274, won: 1722, fraction: 0.6 },
    warnings: [{ code: 'unknown_price', section: 'gross', credits: 70 }],
  }
  const rows = report.buildUsageRows(usage)
  assert.deepEqual(rows.map((row) => [row.section, row.category, row.won, row.fraction]), [
    ['총사용', '유상(요금제 결제)', 3593, null], ['총사용', '관리자 지급', 0, null], ['총사용', '합계', 3593, 0.7],
    ['환불 차감', '유상(요금제 결제)', 1871, null], ['환불 차감', '합계', 1871, 0.1], ['순사용', '합계', 1722, 0.6],
  ])
  assert.equal(report.formatCsvCell('decimal', 0.6000000001), '0.6')
  assert.match(report.describeCreditWarnings(usage.warnings)[0], /단가를 알 수 없는 옛 요금제 구매 크레딧 70 C\(총사용/)
  assert.match(report.describeCreditWarnings([{ code: 'test_payment', section: 'gross', credits: 10 }])[0], /실결제가 아닌.*10 C/)
  // 'paid'(원 단가)는 실결제 주문만: live 환경 + completed·refunded. 나머지 주문은 시험 결제 0원
  assert.match(functionBody('report_credit_usage_value'),
    /plan_purchase' AND po\.id IS NOT NULL AND po\.provider_environment = 'live'\n\s+AND po\.status IN \('completed', 'refunded'\) THEN 'paid'/)
  assert.match(functionBody('report_credit_usage_value'), /THEN 'paid_test'/)
})

test('설정 문구: 필수 키 = 마이그레이션 VERIFY 목록, 없거나 비면 null, 저장은 revision·한 줄·300자', () => {
  const verifyKeys = MIGRATION.match(/FOREACH v_key IN ARRAY ARRAY\[([^\]]+)\] LOOP/)[1].match(/'([^']+)'/g).map((key) => key.slice(1, -1))
  assert.deepEqual(verifyKeys, [...report.SALES_REPORT_CONTENT_TEXT_KEYS])
  const seed = JSON.parse(MIGRATION.match(/\$json_bundle23_content\$([\s\S]+?)\$json_bundle23_content\$/)[1])
  assert.ok(report.parseSalesReportContent(seed), '마이그레이션 첫 값은 읽힌다')
  assert.equal(report.parseSalesReportContent({ ...seed, usageNotice: ' ' }), null)
  assert.equal(report.parseSalesReportContent({ ...seed, revision: undefined }), null)
  assert.doesNotMatch(JSON.stringify(seed), /계좌|담당자|@|010-/, '회원도 읽는 행에 내부 정보 없음')

  const current = report.parseSalesReportContent(seed)
  assert.deepEqual(report.validateSalesReportContentInput({ ...current, revision: 0 }, current), { ok: false, error: 'REVISION_CONFLICT' })
  assert.equal(report.validateSalesReportContentInput({ ...current, netNotice: 'a\nb' }, current).ok, false)
  assert.equal(report.validateSalesReportContentInput({ ...current, netNotice: 'x'.repeat(301) }, current).ok, false)
  const saved = report.validateSalesReportContentInput({ ...current, netNotice: ' 새 문구 ' }, current)
  assert.deepEqual([saved.ok, saved.content.netNotice, saved.content.revision, saved.changedKeys], [true, '새 문구', current.revision + 1, ['netNotice']])
  assert.equal(saved.content.definitionVersion, current.definitionVersion, '정의 판은 화면에서 바꾸지 않음')
})

// ---------------------------------------------------------------------------------------------------------------
// 계약: 함수·권한·열 허용 목록·리허설
// ---------------------------------------------------------------------------------------------------------------
const FUNCTIONS = ['report_charge_daily', 'report_payment_lines', 'report_credit_flow', 'report_credit_usage_value']
const functionBody = (name) => MIGRATION.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]+?\\$fn_${name}\\$;`))[0]

test('함수 4개: SECURITY INVOKER·STABLE·search_path, 운영 helper·회원 보관 표 없음, 권한 회수 뒤 service_role 만', () => {
  for (const name of FUNCTIONS) {
    const body = functionBody(name)
    assert.match(body, /\n STABLE\n SECURITY INVOKER\n SET search_path TO 'public', 'pg_temp'\n/, name)
    assert.doesNotMatch(body, /credit_source_paid_root|credit_source_reissued_descendants|withdrawn_member_records/, `${name}: 금지 helper·표`)
    assert.doesNotMatch(body, /SECURITY DEFINER/, name)
    assert.match(body, /p_to - p_from > interval '366 days'/, `${name}: 366일 넘으면 예외`)
    assert.match(MIGRATION, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(timestamptz, timestamptz\\) FROM PUBLIC, anon, authenticated, service_role;`))
    assert.match(MIGRATION, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(timestamptz, timestamptz\\) TO service_role;`))
  }
  assert.doesNotMatch(MIGRATION.replace(/--[^\n]*/g, ''), /GRANT[^;]*withdrawn_member_records/, '회원 보관 표 GRANT 없음')
  assert.doesNotMatch(MIGRATION.replace(/--[^\n]*/g, ''), /SECURITY DEFINER|\bBEGIN;|\bCOMMIT;/)
  assert.match(MIGRATION, /SET LOCAL lock_timeout = '3s';/)
  assert.match(MIGRATION, /NOTIFY pgrst, 'reload schema';\s*$/)
  assert.match(MIGRATION, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(MIGRATION, /AS RESTRICTIVE FOR UPDATE\n\s+USING \(key <> 'sales_report_content'\)/)
  for (const name of FUNCTIONS) assert.match(DOWN, new RegExp(`DROP FUNCTION public\\.${name}\\(timestamptz, timestamptz\\);`))
  assert.match(DOWN, /DELETE FROM public\.system_settings WHERE key = 'sales_report_content';/)
  assert.match(DOWN, /DROP POLICY IF EXISTS system_settings_sales_report_content_no_client_write/)
  const downDdl = DOWN.slice(DOWN.indexOf('[23번 기존 표 DDL] 시작'), DOWN.indexOf('[23번 기존 표 DDL] 끝'))
  assert.match(downDdl, /DOWN VERIFY: system_settings_sales_report_content_no_client_write policy left/, '정책 남음 검사는 DDL 구역 안(light 는 함께 뺌)')
})

test('report_payment_lines 반환 열 = 허용 목록(금지 칸 없음), VERIFY 도 같은 목록', () => {
  const returns = functionBody('report_payment_lines').match(/RETURNS TABLE\(([\s\S]+?)\)\n/)[1]
  const columns = returns.split(',').map((part) => part.trim().split(/\s+/)[0])
  assert.deepEqual(columns, [...report.PAYMENT_LINE_COLUMNS])
  const verify = MIGRATION.match(/IS DISTINCT FROM ARRAY\['line_kind'[\s\S]+?\]::text\[\]/)[0].match(/'([a-z_]+)'/g).map((item) => item.slice(1, -1))
  assert.deepEqual(verify, [...report.PAYMENT_LINE_COLUMNS])
  const FORBIDDEN = ['reason', 'admin_note', 'note', 'details', 'before_state', 'after_state', 'partner_user_id', 'payment_key', 'user_id',
    'email', 'phone', 'ip', 'user_agent', 'member_reject_reason']
  for (const name of FORBIDDEN) assert.ok(!columns.includes(name), `금지 칸 ${name}`)
  // CSV 열도 허용 목록 칸에서만 만든다(회원 칸 없음)
  const csvSource = read('src/lib/sales-report.ts').match(/export const PAYMENT_COLUMNS[\s\S]+?\n\]\n/)[0]
  for (const used of csvSource.matchAll(/row\.([a-z_]+)/g)) assert.ok(report.PAYMENT_LINE_COLUMNS.includes(used[1]), used[1])
})

test('route: reports.view 가드, no-store, 작업 기록(지문)이 응답보다 먼저이고 실패면 500·파일 없음', () => {
  assert.match(ROUTE, /const guard = await requireAdminApiPermission\('reports\.view'\)/)
  assert.doesNotMatch(ROUTE, /export async function (POST|PUT|PATCH|DELETE)/, 'GET 만')
  assert.match(ROUTE, /'Cache-Control': 'no-store'/)
  const build = ROUTE.indexOf('await buildSalesReportFile(')
  const audit = ROUTE.indexOf('await recordAdminAudit(')
  const refuse = ROUTE.indexOf('if (!recorded)')
  const send = ROUTE.indexOf('new NextResponse(file.csv')
  assert.ok(build > 0 && build < audit && audit < refuse && refuse < send, '쿼리·파일 → 작업 기록 → 확인 → 응답')
  assert.match(ROUTE.slice(refuse, send), /status: 500/)
  assert.match(ROUTE.slice(audit, refuse), /action: 'sales_report_export'[\s\S]*definition_version[\s\S]*row_count[\s\S]*sha256: file\.sha256[\s\S]*request: adminRequestMeta\(request\)/)
  assert.match(SERVER, /createHash\('sha256'\)/)
  assert.match(SERVER, /\.abortSignal\(AbortSignal\.timeout\(SALES_REPORT_QUERY_TIMEOUT_MS\)\)/)
  assert.match(SERVER, /compareChargeTotals\(dayTotals, sumPaymentLines\(lines\)\)/, '요약 = 건별 합 검산')
  // 기본 CSV 에는 회원 칸·열람 기록이 없다(Q3 기본안 — 회원 칸 판은 만들지 않음)
  assert.doesNotMatch(ROUTE + SERVER, /recordMemberAccess|payments_with_member|email/)
  const audits = load('src/lib/admin-audit-log.ts').ADMIN_AUDIT_ACTIONS
  assert.ok(audits.sales_report_export && audits.sales_report_content_update)
})

test('화면·메뉴·액션: reports.view 화면, 사이드바 주문·결제 묶음, 문구 저장은 대표만', () => {
  assert.match(read('src/app/(admin)/admin/reports/page.tsx'), /requireAdminPagePermission\('reports\.view'\)/)
  const sidebar = read('src/lib/admin-sidebar.ts')
  assert.match(sidebar, /ADMIN_PAYMENT_MENU_HREFS = \[[^\]]*'\/admin\/reports'/)
  assert.match(sidebar, /'\/admin\/reports': 'reports\.view'/)
  const actions = read('src/app/(admin)/admin/reports/actions.ts')
  assert.match(actions, /const access = await assertAdminActionPermission\('owner'\)/)
  assert.match(actions, /action: 'sales_report_content_update'/)
  const client = read('src/app/(admin)/admin/reports/sales-report-client.tsx')
  assert.match(client, /내려받은 기록이 남습니다/)
  assert.match(client, /from '@\/components\/admin\/kit\//, '20번 부품')
})

test('리허설: 생성 파일이 최신, light 에 표 잠금 DDL·이력 쓰기·COMMIT 없음, R2 는 11월 예시를 맞춘다', () => {
  const files = buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle23_rehearsal/${name}`), content, `${name} 이 생성기와 같다`)
    assert.doesNotMatch(content, /\bCOMMIT\s*;/)
    assert.match(content.trimEnd(), /ROLLBACK;$/)
  }
  const light = files['a_light.sql'].replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) assert.ok(!light.includes(word), `light: ${word}`)
  assert.match(files['b_full.sql'], /CREATE POLICY system_settings_sales_report_content_no_client_write/)
  assert.match(files['a_light.sql'], /SET LOCAL ROLE service_role;/, 'R5 는 service_role 로 실행')
  assert.match(files['a_light.sql'], /'member_withdraw'[\s\S]+'expired_cleared'/, 'R5 기간 안 가짜 탈퇴 기록')
  assert.match(files['a_light.sql'], /3-4 결제 금액'\);|pg_temp\.eq\(pg_temp\.day_sum\(v_j, 'paymentAmount'\), 60600/)
})
