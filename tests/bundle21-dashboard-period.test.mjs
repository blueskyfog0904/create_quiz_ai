import assert from 'node:assert/strict'
import test from 'node:test'
import { period } from './helpers/admin-dashboard-harness.mjs'

// 21번 묶음 4-2 표·6절 주소 키·7절 주 단위(계획 docs/plan-bundle21-dashboard.md 9절).
const { parseDashboardQuery, resolveDashboardPeriod, dashboardQueryString, formatCompareLabel, bucketByWeek, kstDateList } = period
// 한국 시각 → Date
const kst = (text) => new Date(`${text}+09:00`)
const iso = (text) => kst(text).toISOString()
const span = (range) => [range.from, range.to]
const resolveAt = (query, now) => resolveDashboardPeriod({ subject: 'all', ...query }, kst(now))

test('오늘(오전): [오늘 0시, 지금) 과 [어제 0시, 어제 같은 시각)', () => {
  const resolved = resolveAt({ period: 'today' }, '2026-11-27T09:30:00')
  assert.deepEqual(span(resolved.current), [iso('2026-11-27T00:00:00'), iso('2026-11-27T09:30:00')])
  assert.deepEqual(span(resolved.compare), [iso('2026-11-26T00:00:00'), iso('2026-11-26T09:30:00')])
  assert.equal(resolved.current.ongoing, true)
  assert.deepEqual(resolved.days, ['2026-11-27'])
  assert.equal(formatCompareLabel(resolved.compare), '11-26 ~09:30 대비')
})

test('7일·30일: 오늘 포함 N일, 비교는 같은 경과 시간(지금 − N일 까지)', () => {
  const seven = resolveAt({ period: '7d' }, '2026-11-26T15:12:00')
  assert.deepEqual(span(seven.current), [iso('2026-11-20T00:00:00'), iso('2026-11-26T15:12:00')])
  assert.deepEqual(span(seven.compare), [iso('2026-11-13T00:00:00'), iso('2026-11-19T15:12:00')])
  assert.equal(seven.days.length, 7)
  const thirty = resolveAt({ period: '30d' }, '2026-11-26T15:12:00')
  assert.deepEqual(span(thirty.current), [iso('2026-10-28T00:00:00'), iso('2026-11-26T15:12:00')])
  assert.deepEqual(span(thirty.compare), [iso('2026-09-28T00:00:00'), iso('2026-10-27T15:12:00')])
  assert.equal(thirty.days.length, 30)
  assert.equal(formatCompareLabel(thirty.compare), '09-28~10-27 15:12 대비')
})

test('이번 달: 지난달 1일 ~ 같은 날 같은 시각, 그 날이 없으면 지난달 끝(월말 31일 → 2월, 윤년)', () => {
  const normal = resolveAt({ period: 'month' }, '2026-11-26T15:12:00')
  assert.deepEqual(span(normal.current), [iso('2026-11-01T00:00:00'), iso('2026-11-26T15:12:00')])
  assert.deepEqual(span(normal.compare), [iso('2026-10-01T00:00:00'), iso('2026-10-26T15:12:00')])
  assert.equal(formatCompareLabel(normal.compare), '10-01~10-26 15:12 대비')
  // 3월 31일 → 2월에는 31일이 없다: 2월 끝(3월 1일 0시)까지
  const march = resolveAt({ period: 'month' }, '2027-03-31T10:00:00')
  assert.deepEqual(span(march.compare), [iso('2027-02-01T00:00:00'), iso('2027-03-01T00:00:00')])
  assert.equal(formatCompareLabel(march.compare), '02-01~02-28 대비')
  // 윤년: 2028-03-29 → 2월 29일 같은 시각, 03-30 → 2월 끝
  assert.deepEqual(span(resolveAt({ period: 'month' }, '2028-03-29T08:00:00').compare), [iso('2028-02-01T00:00:00'), iso('2028-02-29T08:00:00')])
  assert.deepEqual(span(resolveAt({ period: 'month' }, '2028-03-30T08:00:00').compare), [iso('2028-02-01T00:00:00'), iso('2028-03-01T00:00:00')])
})

test('지난달: 지난달 전체와 그 앞 달 전체(연말·연초)', () => {
  const january = resolveAt({ period: 'lastMonth' }, '2027-01-05T12:00:00')
  assert.deepEqual(span(january.current), [iso('2026-12-01T00:00:00'), iso('2027-01-01T00:00:00')])
  assert.deepEqual(span(january.compare), [iso('2026-11-01T00:00:00'), iso('2026-12-01T00:00:00')])
  assert.equal(january.current.ongoing, false)
  assert.equal(january.days.length, 31)
  assert.equal(january.current.toDate, '2026-12-31')
})

test('직접 지정: [시작일 0시, 끝일 다음 날 0시), 끝일이 오늘이면 지금까지, 비교는 같은 길이 바로 앞', () => {
  const past = resolveAt({ period: 'custom', from: '2026-10-01', to: '2026-10-10' }, '2026-11-26T15:12:00')
  assert.deepEqual(span(past.current), [iso('2026-10-01T00:00:00'), iso('2026-10-11T00:00:00')])
  assert.deepEqual(span(past.compare), [iso('2026-09-21T00:00:00'), iso('2026-10-01T00:00:00')])
  const today = resolveAt({ period: 'custom', from: '2026-11-20', to: '2026-11-26' }, '2026-11-26T15:12:00')
  assert.equal(today.current.ongoing, true)
  assert.deepEqual(span(today.current), [iso('2026-11-20T00:00:00'), iso('2026-11-26T15:12:00')])
  assert.deepEqual(span(today.compare), [iso('2026-11-13T00:00:00'), iso('2026-11-19T15:12:00')])
  // 366일까지(23번 해석 그대로), 넘으면 기본(30일)
  assert.equal(resolveAt({ period: 'custom', from: '2025-11-26', to: '2026-11-26' }, '2026-11-26T15:12:00').days.length, 366)
  assert.equal(resolveAt({ period: 'custom', from: '2025-11-25', to: '2026-11-26' }, '2026-11-26T15:12:00').query.period, '30d')
  assert.equal(parseDashboardQuery({ period: 'custom', from: '2025-11-25', to: '2026-11-26' }, kst('2026-11-26T15:12:00')).period, '30d')
})

test('주소 값: 잘못된 값은 기본(30d·전체), 날짜만 있으면 custom, 상대 프리셋은 날짜를 싣지 않는다', () => {
  const now = kst('2026-11-26T15:12:00')
  assert.deepEqual(parseDashboardQuery(new URLSearchParams(''), now), { period: '30d', subject: 'all' })
  assert.deepEqual(parseDashboardQuery(new URLSearchParams('period=year&subject=math'), now), { period: '30d', subject: 'all' })
  assert.deepEqual(parseDashboardQuery(new URLSearchParams('period=7d&subject=english&from=2026-01-01&to=2026-01-02'), now), { period: '7d', subject: 'english' })
  assert.deepEqual(parseDashboardQuery(new URLSearchParams('from=2026-11-01&to=2026-11-10&subject=korean'), now), { period: 'custom', subject: 'korean', from: '2026-11-01', to: '2026-11-10' })
  assert.deepEqual(parseDashboardQuery(new URLSearchParams('period=custom&from=2026-11-10&to=2026-11-01'), now), { period: '30d', subject: 'all' })
  assert.deepEqual(parseDashboardQuery(new URLSearchParams('period=custom&from=bad&to=2026-11-01'), now), { period: '30d', subject: 'all' })
  // 미래 끝일은 오늘까지
  assert.deepEqual(parseDashboardQuery({ period: 'custom', from: '2026-11-20', to: '2026-12-31' }, now), { period: 'custom', subject: 'all', from: '2026-11-20', to: '2026-11-26' })
  assert.equal(dashboardQueryString({ period: '30d', subject: 'all' }), 'period=30d')
  assert.equal(dashboardQueryString({ period: 'month', subject: 'korean' }), 'period=month&subject=korean')
  assert.equal(dashboardQueryString({ period: 'custom', subject: 'all', from: '2026-11-01', to: '2026-11-10' }), 'period=custom&from=2026-11-01&to=2026-11-10')
})

test('period=month 로 다시 읽어도(새로고침·공유) 비교 기간이 같다', () => {
  const now = kst('2026-11-26T15:12:00')
  const first = resolveDashboardPeriod(parseDashboardQuery(new URLSearchParams('period=month'), now), now)
  const again = resolveDashboardPeriod(parseDashboardQuery(new URLSearchParams(dashboardQueryString(first.query)), now), now)
  assert.deepEqual(again.compare, first.compare)
  assert.deepEqual(again.current, first.current)
})

test('period=30d 주소를 다음 날 열면 기간이 하루 밀린다(상대 프리셋은 요청 시각 기준)', () => {
  const query = parseDashboardQuery(new URLSearchParams('period=30d'), kst('2026-11-26T15:12:00'))
  const today = resolveDashboardPeriod(query, kst('2026-11-26T15:12:00'))
  const tomorrow = resolveDashboardPeriod(query, kst('2026-11-27T15:12:00'))
  assert.equal(today.current.fromDate, '2026-10-28')
  assert.equal(tomorrow.current.fromDate, '2026-10-29')
  assert.equal(tomorrow.current.toDate, '2026-11-27')
})

test('자정 정각에 오늘을 열어도 빈 구간을 보내지 않는다(DB 함수는 from >= to 를 거절)', () => {
  const resolved = resolveAt({ period: 'today' }, '2026-11-27T00:00:00')
  assert.ok(Date.parse(resolved.current.to) > Date.parse(resolved.current.from))
  assert.ok(Date.parse(resolved.compare.to) > Date.parse(resolved.compare.from))
})

test('bucketByWeek: 한국 날짜 월요일 시작, 앞뒤 잘린 주는 partial', () => {
  // 2026-11-01 은 일요일, 11-02 월요일
  const rows = kstDateList('2026-11-01', '2026-11-17').map((day, index) => ({ day, value: index + 1 }))
  const weeks = bucketByWeek(rows, (row) => row.value)
  assert.deepEqual(weeks.map((week) => [week.from, week.to, week.partial]), [
    ['2026-11-01', '2026-11-01', true],
    ['2026-11-02', '2026-11-08', false],
    ['2026-11-09', '2026-11-15', false],
    ['2026-11-16', '2026-11-17', true],
  ])
  assert.deepEqual(weeks.map((week) => week.value), [1, 2 + 3 + 4 + 5 + 6 + 7 + 8, 9 + 10 + 11 + 12 + 13 + 14 + 15, 16 + 17])
  assert.equal(weeks.reduce((sum, week) => sum + week.value, 0), rows.reduce((sum, row) => sum + row.value, 0))
  assert.deepEqual(bucketByWeek([], () => 1), [])
})

test('366일 기간의 날짜 수 ≤ 367(report_market_daily 는 날짜당 1행 — PostgREST 1,000행 상한 아래)', () => {
  for (const now of ['2026-11-26T15:12:00', '2028-03-01T00:00:01']) {
    const resolved = resolveAt({ period: 'custom', from: '2000-01-01', to: '2100-01-01' }, now)
    assert.ok(resolved.days.length <= 367)
    const longest = resolveDashboardPeriod({ period: 'custom', subject: 'all', ...parseDashboardQuery({ period: 'custom', from: kstDateList('2025-11-26', '2025-11-26')[0], to: '2026-11-26' }, kst(now)) }, kst(now))
    assert.ok(longest.days.length <= 367)
    assert.ok((Date.parse(longest.compare.to) - Date.parse(longest.compare.from)) / 86_400_000 <= 367)
  }
})

test('비교 범위 글: 시작·끝 연도가 다르면 연도까지 적는다(366일 직접 지정)', () => {
  const long = resolveAt({ period: 'custom', from: '2025-11-26', to: '2026-11-26' }, '2026-11-26T15:12:00')
  assert.equal(long.days.length, 366)
  assert.equal(formatCompareLabel(long.compare), '2024-11-25~2025-11-25 15:12 대비')
  const pastYear = resolveAt({ period: 'custom', from: '2025-01-01', to: '2025-12-31' }, '2026-11-26T15:12:00')
  // 365일(2025년 전체)의 비교는 2024-01-02 ~ 2024-12-31 로 같은 해 → MM-DD
  assert.equal(formatCompareLabel(pastYear.compare), '01-02~12-31 대비')
  // 같은 해면 지금처럼 MM-DD
  assert.equal(formatCompareLabel(resolveAt({ period: 'month' }, '2026-11-26T15:12:00').compare), '10-01~10-26 15:12 대비')
  assert.equal(formatCompareLabel(resolveAt({ period: 'lastMonth' }, '2027-01-05T12:00:00').compare), '11-01~11-30 대비')
})
