import 'server-only'

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  CREDIT_COLUMNS,
  PAYMENT_COLUMNS,
  SALES_REPORT_CONTENT_SETTING_KEY,
  SALES_REPORT_QUERY_TIMEOUT_MS,
  SUMMARY_COLUMNS,
  USAGE_COLUMNS,
  buildCreditRows,
  buildCsv,
  buildHeadLines,
  buildSummaryRows,
  buildUsageRows,
  compareChargeTotals,
  describeChargeWarnings,
  describeCreditWarnings,
  parseSalesReportContent,
  sumChargeDays,
  sumPaymentLines,
  type ChargeDaily,
  type CreditFlow,
  type PaymentLine,
  type SalesReportContent,
  type SalesReportKind,
  type SalesReportPeriod,
  type UsageValue,
} from '@/lib/sales-report'

// 23번 묶음(계획 5-1): 보고 함수 4개(service_role 만 EXECUTE, SECURITY INVOKER)를 서버 키로 부르고, 경고를 모으고, CSV 파일을 만든다.
// 설정 문구가 없거나 형식이 틀리면 예외(기본 문구로 대신하지 않는다). 호출마다 20초 제한(4-1).
const db = () => createAdminClient() as unknown as SupabaseClient

// 결제 기준 결과 전체를 '확인 불가'로 멈추는 경우(완료 환불에 금액이 빔, 3-1)
export class SalesReportUnavailableError extends Error {
  constructor(readonly code: 'REFUND_AMOUNT_MISSING' | 'TOTALS_MISMATCH', message: string) {
    super(message)
    this.name = 'SalesReportUnavailableError'
  }
}

async function callReport<T>(name: string, period: SalesReportPeriod): Promise<T> {
  const { data, error } = await db()
    .rpc(name, { p_from: period.fromIso, p_to: period.toIso })
    .abortSignal(AbortSignal.timeout(SALES_REPORT_QUERY_TIMEOUT_MS))
  if (error) {
    if (error.message?.includes('REFUND_AMOUNT_MISSING')) {
      throw new SalesReportUnavailableError('REFUND_AMOUNT_MISSING', '완료된 환불 중 금액이 비어 있는 건이 있어 결제 기준 숫자를 낼 수 없습니다.')
    }
    throw new Error(`매출 보고 함수(${name})를 부르지 못했습니다: ${error.code ?? ''}`)
  }
  return data as T
}

export const fetchChargeDaily = (period: SalesReportPeriod) => callReport<ChargeDaily>('report_charge_daily', period)
export const fetchPaymentLines = (period: SalesReportPeriod) => callReport<PaymentLine[]>('report_payment_lines', period)
export const fetchCreditFlow = (period: SalesReportPeriod) => callReport<CreditFlow>('report_credit_flow', period)
export const fetchUsageValue = (period: SalesReportPeriod) => callReport<UsageValue>('report_credit_usage_value', period)

// ---------------------------------------------------------------------------------------------------------------
// 설정 문구
// ---------------------------------------------------------------------------------------------------------------
export async function readSalesReportContent(): Promise<SalesReportContent> {
  const { data, error } = await db().from('system_settings').select('value').eq('key', SALES_REPORT_CONTENT_SETTING_KEY).maybeSingle()
  if (error) throw new Error(`매출 CSV 문구 조회 실패: ${error.code ?? ''}`)
  const content = parseSalesReportContent((data as { value: unknown } | null)?.value)
  if (!content) throw new Error('매출 CSV 문구(sales_report_content)가 없거나 형식이 맞지 않습니다.')
  return content
}

// 저장(권한·값 검사는 부르는 서버 액션이 한다). 지금 revision 과 같을 때만 바꾼다(동시 저장 충돌 → false).
export async function saveSalesReportContent(content: SalesReportContent, expectedRevision: number): Promise<boolean> {
  const { data, error } = await db()
    .from('system_settings')
    .update({ value: content, updated_at: new Date().toISOString() })
    .eq('key', SALES_REPORT_CONTENT_SETTING_KEY)
    .eq('value->revision', expectedRevision)
    .select('key')
  if (error) throw new Error('매출 CSV 문구를 저장하지 못했습니다.')
  return Boolean(data && data.length > 0)
}

// ---------------------------------------------------------------------------------------------------------------
// 화면 요약(결제 기준이 '확인 불가'여도 크레딧·참고 금액은 보인다)
// ---------------------------------------------------------------------------------------------------------------
export interface SalesReportOverview {
  charge: ChargeDaily | null
  chargeUnavailable: string | null
  credit: CreditFlow
  usage: UsageValue
}

export async function getSalesReportOverview(period: SalesReportPeriod): Promise<SalesReportOverview> {
  const [charge, credit, usage] = await Promise.all([
    fetchChargeDaily(period).then(
      (value) => ({ value, unavailable: null as string | null }),
      (error) => {
        if (error instanceof SalesReportUnavailableError) return { value: null, unavailable: error.message }
        throw error
      }
    ),
    fetchCreditFlow(period),
    fetchUsageValue(period),
  ])
  return { charge: charge.value, chargeUnavailable: charge.unavailable, credit, usage }
}

// ---------------------------------------------------------------------------------------------------------------
// CSV 파일(5-2 순서: 쿼리 → 파일 만들기 → sha256 → 작업 기록(route) → 응답)
// ---------------------------------------------------------------------------------------------------------------
export interface SalesReportFile {
  csv: string
  sha256: string
  rowCount: number
  totals: Record<string, number>
  definitionVersion: number
}

export async function buildSalesReportFile(kind: SalesReportKind, period: SalesReportPeriod, now: Date = new Date()): Promise<SalesReportFile> {
  const content = await readSalesReportContent()
  const head = (warnings: string[]) => buildHeadLines({ kind, period, content, generatedAt: now, warnings })
  let csv: string
  let rowCount: number
  let totals: Record<string, number>

  if (kind === 'summary' || kind === 'payments') {
    // 요약 = 건별 합계(목표 3)를 매번 맞춰 본다. 어긋나면 파일을 만들지 않는다.
    const [charge, lines] = await Promise.all([fetchChargeDaily(period), fetchPaymentLines(period)])
    const dayTotals = sumChargeDays(charge.days)
    const mismatched = compareChargeTotals(dayTotals, sumPaymentLines(lines))
    if (mismatched.length > 0) {
      throw new SalesReportUnavailableError('TOTALS_MISMATCH', `요약과 건별 합계가 맞지 않아 파일을 만들지 않았습니다(${mismatched.join(', ')}).`)
    }
    totals = {
      paymentCount: dayTotals.paymentCount,
      paymentAmount: dayTotals.paymentAmount,
      paymentVat: dayTotals.paymentVat,
      refundCount: dayTotals.refundCount,
      refundAmount: dayTotals.refundAmount,
      netAmount: dayTotals.paymentAmount - dayTotals.refundAmount,
    }
    const warnings = describeChargeWarnings(charge.warnings)
    if (kind === 'summary') {
      const rows = buildSummaryRows(charge)
      csv = buildCsv(head(warnings), SUMMARY_COLUMNS, rows)
      rowCount = rows.length
    } else {
      csv = buildCsv(head(warnings), PAYMENT_COLUMNS, lines)
      rowCount = lines.length
    }
  } else if (kind === 'credits') {
    const flow = await fetchCreditFlow(period)
    const rows = buildCreditRows(flow)
    csv = buildCsv(head(describeCreditWarnings(flow.warnings)), CREDIT_COLUMNS, rows)
    rowCount = rows.length
    totals = {
      grantCredits: flow.lines.filter((line) => line.line === 'grant').reduce((sum, line) => sum + line.credits, 0),
      marketUsageCredits: flow.lines.find((line) => line.line === 'market_usage_ledger')?.credits ?? 0,
      balanceActive: flow.balance.active,
    }
  } else {
    const usage = await fetchUsageValue(period)
    const rows = buildUsageRows(usage)
    csv = buildCsv(head(describeCreditWarnings(usage.warnings)), USAGE_COLUMNS, rows)
    rowCount = rows.length
    totals = { grossCredits: usage.gross.credits, grossWon: usage.gross.won, netCredits: usage.net.credits, netWon: usage.net.won }
  }

  return {
    csv,
    sha256: createHash('sha256').update(csv, 'utf8').digest('hex'),
    rowCount,
    totals,
    definitionVersion: content.definitionVersion,
  }
}
