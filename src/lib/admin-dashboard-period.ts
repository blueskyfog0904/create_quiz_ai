// 21번 묶음(계획 docs/plan-bundle21-dashboard.md 4-2·6·7절): 대시보드 기간 프리셋·비교 기간·주소 값·주 단위 묶기.
// 순수 함수만 둔다(서버·화면·시험이 같이 쓴다). 모든 날짜는 한국 시간(UTC+9, 서머타임 없음).
// 직접 지정 기간의 해석(형식·미래·최대 366일)은 23번 resolveSalesReportPeriod 를 그대로 쓴다.
import { getKstDateStart } from '@/lib/kst-period'
import { kstToday, resolveSalesReportPeriod, SALES_REPORT_MAX_DAYS } from '@/lib/sales-report'

export const DASHBOARD_PERIOD_PRESETS = ['today', '7d', '30d', 'month', 'lastMonth', 'custom'] as const
export type DashboardPreset = (typeof DASHBOARD_PERIOD_PRESETS)[number]
export const DASHBOARD_PERIOD_LABELS: Record<DashboardPreset, string> = {
  today: '오늘',
  '7d': '7일',
  '30d': '30일',
  month: '이번 달',
  lastMonth: '지난달',
  custom: '직접 지정',
}
export const DASHBOARD_DEFAULT_PRESET: DashboardPreset = '30d'

export const DASHBOARD_SUBJECTS = ['all', 'korean', 'english'] as const
export type DashboardSubject = (typeof DASHBOARD_SUBJECTS)[number]
export const DASHBOARD_SUBJECT_LABELS: Record<DashboardSubject, string> = { all: '전체', korean: '국어', english: '영어' }

// 직접 지정 최대 길이(23번과 같은 366일). DB 함수는 367일까지 받는다(5절).
export const DASHBOARD_MAX_CUSTOM_DAYS = SALES_REPORT_MAX_DAYS
// 이 날수를 넘으면 그래프를 주 단위로 묶는다(7절).
export const DASHBOARD_WEEKLY_AFTER_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// 주소 값(6절 '주소 키'): period, subject, custom 일 때만 from·to(한국 날짜).
export interface DashboardQuery {
  period: DashboardPreset
  subject: DashboardSubject
  from?: string
  to?: string
}

type QueryInput = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined

function readParam(input: QueryInput, key: string): string | null {
  if (!input) return null
  if (input instanceof URLSearchParams) return input.get(key)
  const value = input[key]
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

const isPreset = (value: unknown): value is DashboardPreset => typeof value === 'string' && (DASHBOARD_PERIOD_PRESETS as readonly string[]).includes(value)
const isSubject = (value: unknown): value is DashboardSubject => typeof value === 'string' && (DASHBOARD_SUBJECTS as readonly string[]).includes(value)

// 잘못된 값이면 기본(30d·전체). 날짜만 있고 period 가 없으면 custom. 상대 프리셋은 날짜를 싣지 않는다(요청 시각 기준으로 다시 계산).
export function parseDashboardQuery(input: QueryInput, now: Date = new Date()): DashboardQuery {
  const rawSubject = readParam(input, 'subject')
  const subject: DashboardSubject = isSubject(rawSubject) ? rawSubject : 'all'
  const rawPeriod = readParam(input, 'period')
  const from = readParam(input, 'from')
  const to = readParam(input, 'to')
  const period = rawPeriod === null && from && to ? 'custom' : rawPeriod
  if (!isPreset(period)) return { period: DASHBOARD_DEFAULT_PRESET, subject }
  if (period !== 'custom') return { period, subject }
  const resolved = resolveSalesReportPeriod({ from, to }, now)
  if (!resolved.ok) return { period: DASHBOARD_DEFAULT_PRESET, subject }
  return { period: 'custom', subject, from: resolved.period.fromDate, to: resolved.period.toDate }
}

// 주소·요청에 싣는 글(전체 과목은 subject 를 싣지 않는다)
export function dashboardQueryString(query: DashboardQuery): string {
  const params = new URLSearchParams({ period: query.period })
  if (query.subject !== 'all') params.set('subject', query.subject)
  if (query.period === 'custom' && query.from && query.to) {
    params.set('from', query.from)
    params.set('to', query.to)
  }
  return params.toString()
}

// [from, to) 한 구간. fromDate·toDate 는 들어가는 첫·마지막 한국 날짜. ongoing = 끝이 '지금'(덜 찬 기간).
export interface DashboardRange {
  from: string
  to: string
  fromDate: string
  toDate: string
  ongoing: boolean
}

export interface ResolvedDashboardPeriod {
  query: DashboardQuery
  current: DashboardRange
  compare: DashboardRange
  // 지금 기간에 들어가는 한국 날짜(그래프 0 채움 기준)
  days: string[]
}

const kstDateOf = (ms: number) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)

function range(fromMs: number, toMs: number, ongoing: boolean): DashboardRange {
  // 자정 정각에 '오늘'을 열면 [오늘 0시, 지금) 이 비므로 1초를 둔다(DB 함수는 빈 구간을 거절한다).
  const end = Math.max(toMs, fromMs + 1000)
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(end).toISOString(),
    fromDate: kstDateOf(fromMs),
    toDate: kstDateOf(end - 1),
    ongoing,
  }
}

function kstMonthStartMs(now: Date, offset: number): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + offset, 1) - KST_OFFSET_MS
}

// 한국 날짜 목록 [fromDate .. toDate]
export function kstDateList(fromDate: string, toDate: string): string[] {
  const days: string[] = []
  const start = Date.parse(`${fromDate}T00:00:00Z`)
  const end = Date.parse(`${toDate}T00:00:00Z`)
  for (let ms = start; ms <= end; ms += DAY_MS) days.push(new Date(ms).toISOString().slice(0, 10))
  return days
}

// 4-2 표. 오늘이 들어간 기간은 같은 경과 시간끼리 비교한다.
export function resolveDashboardPeriod(query: DashboardQuery, now: Date = new Date()): ResolvedDashboardPeriod {
  const nowMs = now.getTime()
  const todayStart = Date.parse(getKstDateStart(kstToday(now)) as string)
  let current: DashboardRange
  let compare: DashboardRange

  switch (query.period) {
    case 'today':
    case '7d':
    case '30d': {
      const n = query.period === 'today' ? 1 : query.period === '7d' ? 7 : 30
      const start = todayStart - (n - 1) * DAY_MS
      current = range(start, nowMs, true)
      compare = range(start - n * DAY_MS, nowMs - n * DAY_MS, true)
      break
    }
    case 'month': {
      const start = kstMonthStartMs(now, 0)
      const previousStart = kstMonthStartMs(now, -1)
      current = range(start, nowMs, true)
      // 지난달 같은 날 같은 시각. 지난달에 그 날이 없으면 지난달 끝.
      compare = range(previousStart, Math.min(previousStart + (nowMs - start), start), true)
      break
    }
    case 'lastMonth': {
      const start = kstMonthStartMs(now, -1)
      const end = kstMonthStartMs(now, 0)
      current = range(start, end, false)
      compare = range(kstMonthStartMs(now, -2), start, false)
      break
    }
    case 'custom': {
      const resolved = query.from && query.to ? resolveSalesReportPeriod({ from: query.from, to: query.to }, now) : null
      if (!resolved || !resolved.ok) return resolveDashboardPeriod({ period: DASHBOARD_DEFAULT_PRESET, subject: query.subject }, now)
      const { fromIso, toIso, toDate, days } = resolved.period
      const start = Date.parse(fromIso)
      // 끝일이 오늘이면 지금까지(경과 시간 맞춤), 아니면 끝일 다음 날 0시까지.
      const ongoing = toDate === kstToday(now)
      const end = ongoing ? nowMs : Date.parse(toIso)
      current = range(start, end, ongoing)
      compare = range(start - days * DAY_MS, end - days * DAY_MS, ongoing)
      break
    }
  }

  return { query, current, compare, days: kstDateList(current.fromDate, current.toDate) }
}

const KST_TIME = (iso: string) => new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(11, 16)

// 증감 줄의 비교 범위 글: '10-01~10-26 15:12 대비'(끝이 자정이면 시각 없이 마지막 날까지)
// 시작과 끝의 연도가 다르면 연도까지 적는다(최대 366일 비교에서 같은 MM-DD 로 보이지 않게).
export function formatCompareLabel(compare: DashboardRange): string {
  const atMidnight = KST_TIME(compare.to) === '00:00'
  const endDay = atMidnight ? compare.toDate : kstDateOf(Date.parse(compare.to))
  const cut = compare.fromDate.slice(0, 4) === endDay.slice(0, 4) ? 5 : 0
  const head = compare.fromDate.slice(cut)
  if (atMidnight) {
    const last = compare.toDate.slice(cut)
    return head === last ? `${head} 대비` : `${head}~${last} 대비`
  }
  const endDate = endDay.slice(cut)
  // 같은 날 안(오늘 프리셋): '11-26 ~15:12 대비'
  return endDate === head ? `${head} ~${KST_TIME(compare.to)} 대비` : `${head}~${endDate} ${KST_TIME(compare.to)} 대비`
}

// ---------------------------------------------------------------------------------------------------------------
// 주 단위(7절): 90일 초과면 한국 날짜 월요일 시작 주로 묶는다. 앞뒤 잘린 주는 partial(화면이 '(일부)').
// ---------------------------------------------------------------------------------------------------------------
export interface WeekBucket {
  from: string
  to: string
  partial: boolean
  value: number
}

export function bucketByWeek<Row extends { day: string }>(rows: readonly Row[], valueOf: (row: Row) => number): WeekBucket[] {
  const buckets: WeekBucket[] = []
  let current: (WeekBucket & { count: number; weekStart: string }) | null = null
  for (const row of [...rows].sort((a, b) => a.day.localeCompare(b.day))) {
    const ms = Date.parse(`${row.day}T00:00:00Z`)
    const mondayOffset = (new Date(ms).getUTCDay() + 6) % 7
    const weekStart = new Date(ms - mondayOffset * DAY_MS).toISOString().slice(0, 10)
    if (!current || current.weekStart !== weekStart) {
      if (current) buckets.push({ from: current.from, to: current.to, partial: current.count < 7, value: current.value })
      current = { from: row.day, to: row.day, partial: false, value: 0, count: 0, weekStart }
    }
    current.to = row.day
    current.count += 1
    current.value += valueOf(row)
  }
  if (current) buckets.push({ from: current.from, to: current.to, partial: current.count < 7, value: current.value })
  return buckets
}
