// 23번 묶음: 매출·정산 CSV 의 규칙(계획 docs/plan-bundle23-sales-csv.md 4판 3·5-1절). 순수 함수만 둔다(서버·화면·시험이 같이 쓴다).
// 숫자의 정의는 DB 함수 4개(마이그레이션 20261222100000)가 정하고, 여기서는 기간 해석·열 정의·CSV 만들기·합계 검산·파일 이름만 한다.
// 문구(머리 줄·화면 안내)는 DB 설정 행 sales_report_content 에만 있다(코드에 기본 문구 없음). 아래 이름표는 DB 코드값의 이름(규칙)이다.
import {
  PAYMENT_EXTERNAL_METHOD_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  REFUND_REQUEST_ORIGIN_LABELS,
  labelOf,
} from '@/lib/admin-orders'
import { getKstDateStart } from '@/lib/kst-period'

export const SALES_REPORT_CONTENT_SETTING_KEY = 'sales_report_content'
// 한 번에 받을 수 있는 가장 긴 기간(한국 날짜, 시작·끝 포함). DB 함수도 366일을 넘으면 거절한다.
export const SALES_REPORT_MAX_DAYS = 366
// DB 함수 호출 제한 시간(4-1 '호출 쪽 statement_timeout 20초')
export const SALES_REPORT_QUERY_TIMEOUT_MS = 20_000

// ---------------------------------------------------------------------------------------------------------------
// 설정 행(4-2): 머리 문구·화면 안내. 필수 키는 마이그레이션 VERIFY 와 같은 목록.
// ---------------------------------------------------------------------------------------------------------------
export const SALES_REPORT_CONTENT_TEXT_KEYS = [
  'fileTitle', 'headerNotice', 'kstNotice', 'netNotice', 'creditNotice', 'withdrawalNotice', 'expiryNotice', 'usageNotice', 'screenGuide',
] as const
export type SalesReportContentTextKey = (typeof SALES_REPORT_CONTENT_TEXT_KEYS)[number]
export const SALES_REPORT_CONTENT_MAX_LENGTH = 300

// 관리자 편집 칸 이름(관리자 글)
export const SALES_REPORT_CONTENT_KEY_LABELS: Record<SalesReportContentTextKey, string> = {
  fileTitle: '파일 제목',
  headerNotice: '머리 안내(모든 파일)',
  kstNotice: '시간대 안내(모든 파일)',
  netNotice: '순액 안내(요약·결제 건별)',
  creditNotice: '크레딧 표 안내',
  withdrawalNotice: '탈퇴로 줄어드는 기록 안내',
  expiryNotice: '탈퇴 때 정리된 만료 잔량 안내',
  usageNotice: '참고 금액 안내',
  screenGuide: '화면 안내(페이앱 정산 자료와 맞춰 보기)',
}

export interface SalesReportContent extends Record<SalesReportContentTextKey, string> {
  definitionVersion: number
  revision: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function checkContentText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > SALES_REPORT_CONTENT_MAX_LENGTH || CONTROL_CHARACTERS.test(text)) return null
  return text
}

// 필수 키가 하나라도 없거나 형식이 틀리면 null(서버는 예외로 올린다 — 기본 문구로 대신하지 않는다).
export function parseSalesReportContent(value: unknown): SalesReportContent | null {
  if (!isRecord(value)) return null
  if (!Number.isInteger(value.definitionVersion) || !Number.isInteger(value.revision)) return null
  const content = { definitionVersion: value.definitionVersion as number, revision: value.revision as number } as SalesReportContent
  for (const key of SALES_REPORT_CONTENT_TEXT_KEYS) {
    const text = checkContentText(value[key])
    if (text === null) return null
    content[key] = text
  }
  return content
}

export type SalesReportContentInput = Partial<Record<SalesReportContentTextKey, unknown>> & { revision?: unknown }

// 대표 편집 카드 저장 값 검사. 정의 판(definitionVersion)은 화면에서 바꾸지 않는다(정의가 바뀌면 마이그레이션이 올린다).
export function validateSalesReportContentInput(
  input: SalesReportContentInput,
  current: SalesReportContent
): { ok: true; content: SalesReportContent; changedKeys: SalesReportContentTextKey[] } | { ok: false; error: string } {
  if (input?.revision !== current.revision) return { ok: false, error: 'REVISION_CONFLICT' }
  const next = { ...current, revision: current.revision + 1 }
  const changedKeys: SalesReportContentTextKey[] = []
  for (const key of SALES_REPORT_CONTENT_TEXT_KEYS) {
    const text = checkContentText(input[key])
    if (text === null) {
      return { ok: false, error: `${SALES_REPORT_CONTENT_KEY_LABELS[key]}: 1~${SALES_REPORT_CONTENT_MAX_LENGTH}자 한 줄로 적어 주세요.` }
    }
    next[key] = text
    if (text !== current[key]) changedKeys.push(key)
  }
  return { ok: true, content: next, changedKeys }
}

// ---------------------------------------------------------------------------------------------------------------
// 기간(3-5): 한국 날짜(시작·끝 포함) 또는 달. [시작 00:00 KST, 끝 다음 날 00:00 KST). 최대 366일. 미래는 오늘까지.
// ---------------------------------------------------------------------------------------------------------------
export interface SalesReportPeriod {
  fromDate: string
  toDate: string
  fromIso: string
  toIso: string
  days: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

// offset 0 = 이번 달, -1 = 지난달. 이번 달 끝은 오늘.
export function salesReportMonthRange(now: Date = new Date(), offset = 0): { from: string; to: string } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const first = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + offset, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0))
  const today = kstToday(now)
  const to = last.toISOString().slice(0, 10)
  return { from: first.toISOString().slice(0, 10), to: to > today ? today : to }
}

export function resolveSalesReportPeriod(
  input: { from?: string | null; to?: string | null },
  now: Date = new Date()
): { ok: true; period: SalesReportPeriod } | { ok: false; error: string } {
  const today = kstToday(now)
  const fromDate = input.from ?? ''
  let toDate = input.to ?? ''
  if (!getKstDateStart(fromDate) || !getKstDateStart(toDate)) return { ok: false, error: '기간을 YYYY-MM-DD 날짜로 골라 주세요.' }
  if (fromDate > today) return { ok: false, error: '시작일이 오늘보다 뒤입니다.' }
  if (toDate > today) toDate = today
  if (fromDate > toDate) return { ok: false, error: '시작일이 끝일보다 뒤입니다.' }
  const fromIso = getKstDateStart(fromDate) as string
  const toIso = getKstDateStart(toDate, 1) as string
  const days = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS)
  if (days > SALES_REPORT_MAX_DAYS) return { ok: false, error: `기간은 최대 ${SALES_REPORT_MAX_DAYS}일까지 고를 수 있습니다.` }
  return { ok: true, period: { fromDate, toDate, fromIso, toIso, days } }
}

// ---------------------------------------------------------------------------------------------------------------
// DB 함수 결과 모양
// ---------------------------------------------------------------------------------------------------------------
export interface ChargeBreakdown { code?: string | null; label?: string | null; name?: string | null; origin?: string | null; count: number; amount: number; vat: number }
export interface ChargeDay {
  day: string
  paymentCount: number
  paymentAmount: number
  paymentVat: number
  refundCount: number
  refundAmount: number
  refundVat: number
  manualRefundCount: number
  manualRefundAmount: number
  byMethod: ChargeBreakdown[]
  byPlan: ChargeBreakdown[]
  refundByOrigin: ChargeBreakdown[]
  refundByMethod: ChargeBreakdown[]
}
export interface ChargeWarnings {
  manualReviewOrders: number
  cancelPendingOrders: number
  fulfillmentPendingOrders: number
  partialCancelOpen: number
  fullRefundVatMismatch: number
  manualActionsWithoutRefund: number
}
export interface ChargeDaily { days: ChargeDay[]; warnings: ChargeWarnings }

export interface PaymentLine {
  line_kind: 'payment' | 'refund'
  order_id: string | null
  payment_request_id: string | null
  payment_method_code: string | null
  payment_method_label: string | null
  plan_name: string | null
  order_status: string | null
  amount: number
  vat: number
  supply_amount: number
  paid_at: string | null
  refunded_at: string | null
  refund_origin: string | null
  external_method: string | null
}
// 4-1 열 허용 목록(DB 함수 반환 열 — 마이그레이션 VERIFY 와 같은 순서). 이 밖의 칸은 CSV 에 넣지 않는다.
export const PAYMENT_LINE_COLUMNS = [
  'line_kind', 'order_id', 'payment_request_id', 'payment_method_code', 'payment_method_label', 'plan_name', 'order_status',
  'amount', 'vat', 'supply_amount', 'paid_at', 'refunded_at', 'refund_origin', 'external_method',
] as const satisfies readonly (keyof PaymentLine)[]

export interface CreditFlowLine {
  line: string
  category: string | null
  subject: string | null
  purchaseType: string | null
  count: number | null
  credits: number
}
export interface CreditFlowWarning { code: string; [key: string]: unknown }
export interface CreditFlow {
  lines: CreditFlowLine[]
  balance: { active: number; pendingRefund: number; at: string }
  warnings: CreditFlowWarning[]
}

export interface UsageSection { rows?: { category: string; credits: number; won: number }[]; credits: number; won: number; fraction: number }
export interface UsageValue { gross: UsageSection; refund: UsageSection; net: UsageSection; warnings: CreditFlowWarning[] }

// ---------------------------------------------------------------------------------------------------------------
// 이름표(DB 코드값 → 이름)
// ---------------------------------------------------------------------------------------------------------------
export const SALES_REPORT_KINDS = ['summary', 'payments', 'credits', 'usage'] as const
export type SalesReportKind = (typeof SALES_REPORT_KINDS)[number]
export const SALES_REPORT_KIND_LABELS: Record<SalesReportKind, string> = {
  summary: '결제 기준 요약',
  payments: '결제·환불 건별',
  credits: '크레딧 흐름',
  usage: '사용분 참고 금액',
}
export function isSalesReportKind(value: unknown): value is SalesReportKind {
  return typeof value === 'string' && (SALES_REPORT_KINDS as readonly string[]).includes(value)
}

export const CREDIT_FLOW_LINE_LABELS: Record<string, string> = {
  grant: '지급',
  market_refund_restored: '자료 환불 되돌림',
  market_refund_reissued: '자료 환불 재지급',
  market_refund_unrecovered: '자료 환불 못 돌려줌',
  market_refund_legacy: '자료 환불 되돌림(옛 방식, 나눔 없음)',
  market_usage_ledger: '자료 구매 사용(원장)',
  market_usage_order: '자료 구매 사용(주문 표 나눔)',
  market_usage_without_order: '주문 행 없는 사용',
  charge_refund_recovered: '충전 환불 회수',
  admin_revoke: '관리자 회수',
  expired: '만료 소멸',
  withdrawal_expired_cleared: '탈퇴 때 정리된 만료 잔량',
  withdrawal_forfeit: '탈퇴 소멸',
  generation_usage: '생성 기능 사용',
}
export const CREDIT_CATEGORY_LABELS: Record<string, string> = {
  plan_purchase: '요금제 구매',
  admin_grant: '관리자 지급',
  system_refund: '자료 환불 재지급',
  bonus: '보너스',
  legacy_unknown: '옛 분류',
  paid: '유상(요금제 결제)',
  paid_unknown_price: '요금제 구매(단가 알 수 없음)',
  paid_test: '시험·미완료 결제(0원)',
  unknown_source: '출처 알 수 없음',
}
export const SUBJECT_LABELS: Record<string, string> = { korean: '국어', english: '영어' }
export const PURCHASE_TYPE_LABELS: Record<string, string> = { subproduct: '개별 구매', bundle: '전체 구매', legacy_backfill: '옛 구매' }
export const PAYMENT_LINE_KIND_LABELS: Record<string, string> = { payment: '결제', refund: '환불' }

// 경고 한 줄 글(화면 띠·CSV 머리 줄). 숫자는 DB 값.
export function describeChargeWarnings(warnings: ChargeWarnings): string[] {
  const lines: string[] = []
  if (warnings.manualReviewOrders > 0) lines.push(`수동 확인 중인 주문 ${warnings.manualReviewOrders}건(결제 합계에 들어가지 않음)`)
  if (warnings.cancelPendingOrders > 0) lines.push(`취소 처리 중인 주문 ${warnings.cancelPendingOrders}건`)
  if (warnings.fulfillmentPendingOrders > 0) lines.push(`지급 대기 결제 ${warnings.fulfillmentPendingOrders}건(결제 합계에 아직 들어가지 않음 — 지급되면 결제 시각의 기간에 들어감)`)
  if (warnings.partialCancelOpen > 0) lines.push(`완료 전 부분취소 ${warnings.partialCancelOpen}건(페이앱 자료로 금액 확인)`)
  if (warnings.fullRefundVatMismatch > 0) lines.push(`전액 환불 부가세가 원 주문 부가세와 다른 건 ${warnings.fullRefundVatMismatch}건`)
  if (warnings.manualActionsWithoutRefund > 0) lines.push(`환불 요청 없는 수동 처리 기록 ${warnings.manualActionsWithoutRefund}건(RB-10 9-3 으로 확인)`)
  return lines
}

export function describeCreditWarnings(warnings: CreditFlowWarning[]): string[] {
  return warnings.map((warning) => {
    switch (warning.code) {
      case 'usage_without_order': return `주문 행 없는 사용 ${warning.credits} C(원장 합과 주문 표 합의 차이)`
      case 'reissue_mismatch': return `자료 환불 재지급 합(${warning.allocated} C)이 이어진 재지급 출처 합(${warning.linked} C)과 다름`
      case 'revoke_count_mismatch': return `관리자 회수 기록 ${warning.audit}건과 원장 회수 행 ${warning.ledger}건이 다름`
      case 'generation_usage': return `꺼진 생성 기능 사용 ${warning.credits} C`
      case 'expired_undercount': return `탈퇴 때 정리된 만료 잔량 ${warning.credits} C — 만료 소멸이 그만큼 적게 보일 수 있음`
      case 'test_payment': return `실결제가 아닌(시험 환경·미완료) 결제에서 온 크레딧 ${warning.credits} C(${warning.section === 'refund' ? '환불 차감' : '총사용'}, 0원으로 셈)`
      case 'unknown_price': return `단가를 알 수 없는 옛 요금제 구매 크레딧 ${warning.credits} C(${warning.section === 'refund' ? '환불 차감' : '총사용'}, 0원으로 셈)`
      case 'unknown_source': return `출처를 찾지 못한 크레딧 ${warning.credits} C(${warning.section === 'refund' ? '환불 차감' : '총사용'}, 0원으로 셈)`
      default: return `확인 필요: ${warning.code}`
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// 합계·검산(목표 3: 결제 기준 요약 = 건별 합계)
// ---------------------------------------------------------------------------------------------------------------
export interface ChargeTotals {
  paymentCount: number
  paymentAmount: number
  paymentVat: number
  refundCount: number
  refundAmount: number
  refundVat: number
  manualRefundCount: number
  manualRefundAmount: number
}

export function sumChargeDays(days: ChargeDay[]): ChargeTotals {
  const totals: ChargeTotals = { paymentCount: 0, paymentAmount: 0, paymentVat: 0, refundCount: 0, refundAmount: 0, refundVat: 0, manualRefundCount: 0, manualRefundAmount: 0 }
  for (const day of days) {
    for (const key of Object.keys(totals) as (keyof ChargeTotals)[]) totals[key] += Number(day[key]) || 0
  }
  return totals
}

export function sumPaymentLines(lines: PaymentLine[]): ChargeTotals {
  const totals: ChargeTotals = { paymentCount: 0, paymentAmount: 0, paymentVat: 0, refundCount: 0, refundAmount: 0, refundVat: 0, manualRefundCount: 0, manualRefundAmount: 0 }
  for (const line of lines) {
    if (line.line_kind === 'payment') {
      totals.paymentCount += 1
      totals.paymentAmount += line.amount
      totals.paymentVat += line.vat
    } else {
      totals.refundCount += 1
      totals.refundAmount += line.amount
      totals.refundVat += line.vat
      if (line.external_method) {
        totals.manualRefundCount += 1
        totals.manualRefundAmount += line.amount
      }
    }
  }
  return totals
}

// 다르면 어긋난 칸 이름 목록(빈 배열이면 맞음)
export function compareChargeTotals(a: ChargeTotals, b: ChargeTotals): string[] {
  return (Object.keys(a) as (keyof ChargeTotals)[]).filter((key) => a[key] !== b[key])
}

// 결제수단·요금제·환불 경위별 합(기간 전체)
export function mergeBreakdowns(days: ChargeDay[], key: 'byMethod' | 'byPlan' | 'refundByOrigin' | 'refundByMethod') {
  const map = new Map<string, { key: string; label: string; count: number; amount: number; vat: number }>()
  for (const day of days) {
    for (const item of day[key] ?? []) {
      const id = String(item.code ?? item.name ?? item.origin ?? '')
      const label = key === 'refundByOrigin' ? labelOf(REFUND_REQUEST_ORIGIN_LABELS, item.origin) : String(item.label ?? item.name ?? item.code ?? '-')
      const row = map.get(id) ?? { key: id, label, count: 0, amount: 0, vat: 0 }
      row.count += Number(item.count) || 0
      row.amount += Number(item.amount) || 0
      row.vat += Number(item.vat) || 0
      map.set(id, row)
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
}

// ---------------------------------------------------------------------------------------------------------------
// CSV(Q7·5-1): UTF-8 BOM, 쉼표, \r\n, 금액은 정수(원), 날짜는 한국 시간 YYYY-MM-DD HH:MM:SS.
// 수식 주입 막기: 모든 문자열 칸(머리 줄·열 제목·DB 문구·결제수단·요금제 이름 포함)이 = + - @ 탭 CR 로 시작하면 앞에 '.
//   앞쪽 공백·줄바꿈(전각 공백 포함)을 건너뛴 첫 글자도 보고, 전각 기호(＝ ＋ － ＠)도 막는다(가져올 때 공백을 잘라 내는 프로그램 대비).
// 숫자 칸은 열 정의가 정수(integer)·소수(decimal)인 것만 숫자로 내보낸다(음수 순액 -1000 은 숫자 그대로).
// ---------------------------------------------------------------------------------------------------------------
export type CsvColumnType = 'text' | 'integer' | 'decimal' | 'datetime'
export interface CsvColumn<Row> {
  header: string
  type: CsvColumnType
  value: (row: Row) => unknown
}

const CONTROL_START = /^[\t\r]/
const FORMULA_START = /^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/

export function escapeCsvText(value: string): string {
  const risky = CONTROL_START.test(value) || FORMULA_START.test(value.trimStart())
  const safe = risky ? `'${value}` : value
  return /[",\r\n]/.test(safe) || safe !== safe.trim() ? `"${safe.replaceAll('"', '""')}"` : safe
}

const kstDateTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function formatKstDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(kstDateTimeFormat.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatCsvCell(type: CsvColumnType, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (type === 'integer') {
    const number = Number(value)
    if (!Number.isFinite(number) || !Number.isInteger(number)) throw new Error('CSV_INTEGER_INVALID')
    return String(number)
  }
  if (type === 'decimal') {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error('CSV_DECIMAL_INVALID')
    return String(Math.round(number * 10000) / 10000)
  }
  if (type === 'datetime') return formatKstDateTime(value as string)
  return escapeCsvText(String(value))
}

export function buildCsv<Row>(headLines: string[], columns: CsvColumn<Row>[], rows: Row[]): string {
  const lines = [
    ...headLines.map((line) => escapeCsvText(line)),
    '',
    columns.map((column) => escapeCsvText(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => formatCsvCell(column.type, column.value(row))).join(',')),
  ]
  return `﻿${lines.join('\r\n')}\r\n`
}

export function salesReportFileName(kind: SalesReportKind, period: SalesReportPeriod): string {
  return `sales-${kind}-${period.fromDate}_${period.toDate}.csv`
}

// ---------------------------------------------------------------------------------------------------------------
// 파일 4종의 줄
// ---------------------------------------------------------------------------------------------------------------
export interface SummaryRow { section: string; item: string; count: number | null; amount: number; vat: number | null; supply: number | null }

const summaryRow = (section: string, item: string, count: number | null, amount: number, vat: number): SummaryRow => ({
  section, item, count, amount, vat, supply: amount - vat,
})

export function buildSummaryRows(charge: ChargeDaily): SummaryRow[] {
  const totals = sumChargeDays(charge.days)
  const rows: SummaryRow[] = [
    summaryRow('합계', '결제', totals.paymentCount, totals.paymentAmount, totals.paymentVat),
    summaryRow('합계', '환불', totals.refundCount, totals.refundAmount, totals.refundVat),
    summaryRow('합계', '순액(결제 − 환불)', null, totals.paymentAmount - totals.refundAmount, totals.paymentVat - totals.refundVat),
    // 수동 처리 환불은 환불 합계 안의 일부(건수·금액만, RB-10 9-3 대조용)
    { section: '합계', item: '수동 처리 환불(환불에 포함)', count: totals.manualRefundCount, amount: totals.manualRefundAmount, vat: null, supply: null },
  ]
  for (const item of mergeBreakdowns(charge.days, 'byMethod')) rows.push(summaryRow('결제수단별 결제', item.label, item.count, item.amount, item.vat))
  for (const item of mergeBreakdowns(charge.days, 'byPlan')) rows.push(summaryRow('요금제별 결제', item.label, item.count, item.amount, item.vat))
  for (const item of mergeBreakdowns(charge.days, 'refundByMethod')) rows.push(summaryRow('결제수단별 환불', item.label, item.count, item.amount, item.vat))
  for (const item of mergeBreakdowns(charge.days, 'refundByOrigin')) rows.push(summaryRow('환불 경위별', item.label, item.count, item.amount, item.vat))
  for (const day of charge.days) {
    rows.push(summaryRow('일별 결제', day.day, day.paymentCount, day.paymentAmount, day.paymentVat))
    rows.push(summaryRow('일별 환불', day.day, day.refundCount, day.refundAmount, day.refundVat))
  }
  return rows
}

export const SUMMARY_COLUMNS: CsvColumn<SummaryRow>[] = [
  { header: '구분', type: 'text', value: (row) => row.section },
  { header: '항목', type: 'text', value: (row) => row.item },
  { header: '건수', type: 'integer', value: (row) => row.count },
  { header: '금액(부가세 포함, 원)', type: 'integer', value: (row) => row.amount },
  { header: '부가세(원)', type: 'integer', value: (row) => row.vat },
  { header: '공급가액(원)', type: 'integer', value: (row) => row.supply },
]

export const PAYMENT_COLUMNS: CsvColumn<PaymentLine>[] = [
  { header: '구분', type: 'text', value: (row) => labelOf(PAYMENT_LINE_KIND_LABELS, row.line_kind) },
  { header: '주문번호', type: 'text', value: (row) => row.order_id },
  { header: '결제요청번호', type: 'text', value: (row) => row.payment_request_id },
  { header: '결제수단 코드', type: 'text', value: (row) => row.payment_method_code },
  { header: '결제수단', type: 'text', value: (row) => row.payment_method_label },
  { header: '요금제', type: 'text', value: (row) => row.plan_name },
  { header: '주문 상태', type: 'text', value: (row) => (row.order_status ? labelOf(PAYMENT_ORDER_STATUS_LABELS, row.order_status) : '') },
  { header: '금액(원)', type: 'integer', value: (row) => row.amount },
  { header: '부가세(원)', type: 'integer', value: (row) => row.vat },
  { header: '공급가액(원)', type: 'integer', value: (row) => row.supply_amount },
  { header: '결제 시각', type: 'datetime', value: (row) => row.paid_at },
  { header: '환불 시각', type: 'datetime', value: (row) => row.refunded_at },
  { header: '환불 경위 코드', type: 'text', value: (row) => row.refund_origin },
  { header: '환불 경위', type: 'text', value: (row) => (row.refund_origin ? labelOf(REFUND_REQUEST_ORIGIN_LABELS, row.refund_origin) : '') },
  { header: '처리 방식 코드', type: 'text', value: (row) => row.external_method },
  { header: '처리 방식', type: 'text', value: (row) => (row.external_method ? labelOf(PAYMENT_EXTERNAL_METHOD_LABELS, row.external_method) : '') },
]

export interface CreditRow { line: string; category: string; subject: string; purchaseType: string; count: number | null; credits: number }

export function buildCreditRows(flow: CreditFlow): CreditRow[] {
  const rows: CreditRow[] = flow.lines.map((line) => ({
    line: CREDIT_FLOW_LINE_LABELS[line.line] ?? line.line,
    category: line.category ? CREDIT_CATEGORY_LABELS[line.category] ?? line.category : '',
    subject: line.subject ? SUBJECT_LABELS[line.subject] ?? line.subject : '',
    purchaseType: line.purchaseType ? PURCHASE_TYPE_LABELS[line.purchaseType] ?? line.purchaseType : '',
    count: line.count,
    credits: line.credits,
  }))
  rows.push({ line: '잔액(내려받은 시각, 사용 가능)', category: '', subject: '', purchaseType: '', count: null, credits: flow.balance.active })
  rows.push({ line: '잔액(내려받은 시각, 환불 진행 중)', category: '', subject: '', purchaseType: '', count: null, credits: flow.balance.pendingRefund })
  return rows
}

export const CREDIT_COLUMNS: CsvColumn<CreditRow>[] = [
  { header: '줄', type: 'text', value: (row) => row.line },
  { header: '분류', type: 'text', value: (row) => row.category },
  { header: '과목', type: 'text', value: (row) => row.subject },
  { header: '구매 방식', type: 'text', value: (row) => row.purchaseType },
  { header: '건수', type: 'integer', value: (row) => row.count },
  { header: '크레딧(C)', type: 'integer', value: (row) => row.credits },
]

export interface UsageRow { section: string; category: string; credits: number; won: number; fraction: number | null }

export function buildUsageRows(usage: UsageValue): UsageRow[] {
  const rows: UsageRow[] = []
  const sections: [string, UsageSection][] = [['총사용', usage.gross], ['환불 차감', usage.refund]]
  for (const [label, section] of sections) {
    for (const row of section.rows ?? []) {
      rows.push({ section: label, category: CREDIT_CATEGORY_LABELS[row.category] ?? row.category, credits: row.credits, won: row.won, fraction: null })
    }
    rows.push({ section: label, category: '합계', credits: section.credits, won: section.won, fraction: section.fraction })
  }
  rows.push({ section: '순사용', category: '합계', credits: usage.net.credits, won: usage.net.won, fraction: usage.net.fraction })
  return rows
}

export const USAGE_COLUMNS: CsvColumn<UsageRow>[] = [
  { header: '구분', type: 'text', value: (row) => row.section },
  { header: '뿌리 분류', type: 'text', value: (row) => row.category },
  { header: '크레딧(C)', type: 'integer', value: (row) => row.credits },
  { header: '참고 금액(원, 원 미만 버림)', type: 'integer', value: (row) => row.won },
  { header: '끝수(원)', type: 'decimal', value: (row) => row.fraction },
]

// 머리 줄: 제목·기간·정의 판·만든 시각·DB 문구·경고
export function buildHeadLines(input: {
  kind: SalesReportKind
  period: SalesReportPeriod
  content: SalesReportContent
  generatedAt: Date
  warnings: string[]
}): string[] {
  const { kind, period, content } = input
  const notices: Record<SalesReportKind, SalesReportContentTextKey[]> = {
    summary: ['netNotice'],
    payments: ['netNotice'],
    credits: ['creditNotice', 'withdrawalNotice', 'expiryNotice'],
    usage: ['usageNotice', 'withdrawalNotice'],
  }
  return [
    `${content.fileTitle} — ${SALES_REPORT_KIND_LABELS[kind]}`,
    `기간: ${period.fromDate} ~ ${period.toDate}(한국 시간, 시작·끝 포함)`,
    `정의 판: ${content.definitionVersion}`,
    `만든 시각: ${formatKstDateTime(input.generatedAt)}`,
    content.headerNotice,
    content.kstNotice,
    ...notices[kind].map((key) => content[key]),
    ...input.warnings.map((warning) => `경고: ${warning}`),
  ]
}
