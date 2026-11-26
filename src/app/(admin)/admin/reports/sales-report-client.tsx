'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download } from 'lucide-react'

import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminMetricCard, AdminMetricGrid } from '@/components/admin/kit/admin-metric-card'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar, type AdminSaveStatus } from '@/components/admin/kit/admin-save-bar'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCount, formatCredits, formatWon } from '@/lib/admin-format'
import {
  SALES_REPORT_CONTENT_KEY_LABELS,
  SALES_REPORT_CONTENT_MAX_LENGTH,
  SALES_REPORT_CONTENT_TEXT_KEYS,
  SALES_REPORT_KINDS,
  SALES_REPORT_KIND_LABELS,
  buildCreditRows,
  buildUsageRows,
  describeChargeWarnings,
  describeCreditWarnings,
  mergeBreakdowns,
  salesReportMonthRange,
  sumChargeDays,
  type CreditRow,
  type SalesReportContent,
  type SalesReportContentTextKey,
  type SalesReportKind,
  type SalesReportPeriod,
  type UsageRow,
} from '@/lib/sales-report'
import type { SalesReportOverview } from '@/lib/sales-report-server'
import { saveSalesReportContentAction } from './actions'

interface SalesReportClientProps {
  period: SalesReportPeriod | null
  overview: SalesReportOverview | null
  content: SalesReportContent | null
  isOwner: boolean
  loadError: string | null
}

type BreakdownRow = ReturnType<typeof mergeBreakdowns>[number]

const breakdownColumns: AdminDataTableColumn<BreakdownRow>[] = [
  { key: 'label', header: '항목', cell: (row) => row.label },
  { key: 'count', header: '건수', numeric: true, cell: (row) => formatCount(row.count, '건') },
  { key: 'amount', header: '금액(부가세 포함)', numeric: true, cell: (row) => formatWon(row.amount) },
  { key: 'vat', header: '부가세', numeric: true, cell: (row) => formatWon(row.vat) },
  { key: 'supply', header: '공급가액', numeric: true, cell: (row) => formatWon(row.amount - row.vat) },
]

const creditColumns: AdminDataTableColumn<CreditRow>[] = [
  { key: 'line', header: '줄', cell: (row) => row.line },
  { key: 'category', header: '분류', cell: (row) => row.category || '–' },
  { key: 'subject', header: '과목', cell: (row) => row.subject || '–' },
  { key: 'purchaseType', header: '구매 방식', cell: (row) => row.purchaseType || '–' },
  { key: 'count', header: '건수', numeric: true, cell: (row) => formatCount(row.count, '건') },
  { key: 'credits', header: '크레딧', numeric: true, cell: (row) => formatCredits(row.credits) },
]

const usageColumns: AdminDataTableColumn<UsageRow>[] = [
  { key: 'section', header: '구분', cell: (row) => row.section },
  { key: 'category', header: '뿌리 분류', cell: (row) => row.category },
  { key: 'credits', header: '크레딧', numeric: true, cell: (row) => formatCredits(row.credits) },
  { key: 'won', header: '참고 금액', numeric: true, cell: (row) => formatWon(row.won) },
  { key: 'fraction', header: '끝수', numeric: true, cell: (row) => (row.fraction === null ? '–' : `${row.fraction}원`) },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 space-y-3">
      <h2 className="text-lg font-semibold text-[var(--studio-ink)]">{title}</h2>
      {children}
    </section>
  )
}

// 기간 고르기: 이번 달·지난달·직접(주소 from·to 로 다시 읽는다)
function PeriodPicker({ period }: { period: SalesReportPeriod | null }) {
  const router = useRouter()
  const [from, setFrom] = React.useState(period?.fromDate ?? '')
  const [to, setTo] = React.useState(period?.toDate ?? '')
  const go = (next: { from: string; to: string }) => router.push(`/admin/reports?from=${next.from}&to=${next.to}`)
  return (
    <div className="mb-6 flex flex-wrap items-end gap-2 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-3">
      <Button type="button" variant="adminTable" size="sm" onClick={() => go(salesReportMonthRange(new Date(), 0))}>이번 달</Button>
      <Button type="button" variant="adminTable" size="sm" onClick={() => go(salesReportMonthRange(new Date(), -1))}>지난달</Button>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sales-report-from" className="text-xs">시작일</Label>
        <Input id="sales-report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-8 w-40" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="sales-report-to" className="text-xs">끝일</Label>
        <Input id="sales-report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-8 w-40" />
      </div>
      <Button type="button" variant="brand" size="sm" disabled={!from || !to} onClick={() => go({ from, to })}>조회</Button>
      <span className="ml-auto text-xs text-[var(--studio-muted)]">한국 시간 기준 · 최대 366일 · 미래는 오늘까지</span>
    </div>
  )
}

// 내려받기: 공통 확인 창 → route(작업 기록이 남은 뒤에만 파일을 준다) → 파일 저장
function DownloadButtons({ period, chargeUnavailable }: { period: SalesReportPeriod; chargeUnavailable: boolean }) {
  const { ask, dialog } = useAdminConfirm()
  const [busy, setBusy] = React.useState<SalesReportKind | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const download = async (kind: SalesReportKind) => {
    const ok = await ask({
      title: 'CSV 내려받기',
      description: `기간 ${period.fromDate} ~ ${period.toDate}의 ${SALES_REPORT_KIND_LABELS[kind]} CSV 를 내려받습니다. 내려받은 기록이 남습니다.`,
      confirmLabel: '내려받기',
    })
    if (!ok) return
    setBusy(kind)
    setError(null)
    try {
      const response = await fetch(`/api/admin/reports/export?kind=${kind}&from=${period.fromDate}&to=${period.toDate}`, { cache: 'no-store' })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? '파일을 내려받지 못했습니다.')
        return
      }
      const blob = await response.blob()
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? `sales-${kind}.csv`
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {SALES_REPORT_KINDS.map((kind) => (
          <Button
            key={kind}
            type="button"
            variant="adminTable"
            size="sm"
            disabled={busy !== null || (chargeUnavailable && (kind === 'summary' || kind === 'payments'))}
            onClick={() => void download(kind)}
          >
            <Download aria-hidden="true" className="size-4" />
            {busy === kind ? '만드는 중' : SALES_REPORT_KIND_LABELS[kind]}
          </Button>
        ))}
      </div>
      {error ? <AdminNotice kind="error">{error}</AdminNotice> : null}
      {dialog}
    </div>
  )
}

// 대표 전용: 머리 문구·화면 안내 고치기(회원도 읽을 수 있는 설정 행 — 내부 절차·계좌·담당자 정보는 넣지 않는다)
function ContentEditor({ content }: { content: SalesReportContent }) {
  const router = useRouter()
  const [saved, setSaved] = React.useState(content)
  const [draft, setDraft] = React.useState<Record<SalesReportContentTextKey, string>>(() => ({ ...content }))
  const [status, setStatus] = React.useState<AdminSaveStatus>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [savedAt, setSavedAt] = React.useState<Date | null>(null)
  const dirtyCount = SALES_REPORT_CONTENT_TEXT_KEYS.filter((key) => draft[key] !== saved[key]).length

  const save = async () => {
    setStatus('saving')
    setError(null)
    const result = await saveSalesReportContentAction({ ...draft, revision: saved.revision })
    if (!result.ok) {
      setStatus('error')
      setError(result.error)
      return
    }
    setSaved(result.data)
    setDraft({ ...result.data })
    setStatus('saved')
    setSavedAt(new Date())
    router.refresh()
  }

  return (
    <div className="space-y-4 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
      <AdminNotice kind="info">
        이 문구는 CSV 머리 줄과 이 화면에 나옵니다. 로그인한 회원도 읽을 수 있는 설정이라 내부 절차·계좌·담당자 정보는 넣지 마세요. {content.screenGuide}
      </AdminNotice>
      {SALES_REPORT_CONTENT_TEXT_KEYS.map((key) => (
        <div key={key} className="space-y-1">
          <Label htmlFor={`sales-report-content-${key}`}>{SALES_REPORT_CONTENT_KEY_LABELS[key]}</Label>
          <Input
            id={`sales-report-content-${key}`}
            value={draft[key]}
            maxLength={SALES_REPORT_CONTENT_MAX_LENGTH}
            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
          />
        </div>
      ))}
      <AdminSaveBar
        variant="inline"
        dirtyCount={dirtyCount}
        status={status}
        savedAt={savedAt}
        errorMessage={error}
        applyNote="다음 내려받기부터 반영"
        onSave={() => void save()}
        saveDisabled={dirtyCount === 0 || status === 'saving'}
      />
    </div>
  )
}

export function SalesReportClient({ period, overview, content, isOwner, loadError }: SalesReportClientProps) {
  const charge = overview?.charge ?? null
  const totals = charge ? sumChargeDays(charge.days) : null
  const warnings = [
    ...(charge ? describeChargeWarnings(charge.warnings) : []),
    ...(overview ? describeCreditWarnings(overview.credit.warnings) : []),
    ...(overview ? describeCreditWarnings(overview.usage.warnings) : []),
  ]

  return (
    <div>
      {/* 주소의 기간이 바뀌면 입력칸을 새 기간으로 다시 맞춘다 */}
      <PeriodPicker key={`${period?.fromDate ?? ''}_${period?.toDate ?? ''}`} period={period} />
      {loadError ? <AdminNotice kind="error" className="mb-6">{loadError}</AdminNotice> : null}
      {content ? <AdminNotice kind="info" className="mb-4">{content.screenGuide}</AdminNotice> : null}
      {overview?.chargeUnavailable ? (
        <AdminNotice kind="error" title="결제 기준 확인 불가" className="mb-4">
          {overview.chargeUnavailable} 결제 요약·건별 CSV 는 내려받을 수 없습니다.
        </AdminNotice>
      ) : null}
      {warnings.length > 0 ? (
        <AdminNotice kind="warning" title="확인할 것" className="mb-6">
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </AdminNotice>
      ) : null}

      {period && overview ? (
        <>
          <Section title="내려받기">
            <DownloadButtons period={period} chargeUnavailable={Boolean(overview.chargeUnavailable)} />
          </Section>

          <Section title="결제 기준(원)">
            {charge && totals ? (
              <>
                <AdminMetricGrid>
                  <AdminMetricCard title="결제" value={formatWon(totals.paymentAmount)}
                    sub={`${formatCount(totals.paymentCount, '건')} · 부가세 ${formatWon(totals.paymentVat)} · 공급가액 ${formatWon(totals.paymentAmount - totals.paymentVat)}`} />
                  <AdminMetricCard title="환불" value={formatWon(totals.refundAmount)}
                    sub={`${formatCount(totals.refundCount, '건')} · 부가세 ${formatWon(totals.refundVat)} · 수동 처리 ${formatCount(totals.manualRefundCount, '건')}`} />
                  <AdminMetricCard title="순액(결제 − 환불)" value={formatWon(totals.paymentAmount - totals.refundAmount)}
                    sub={`부가세 ${formatWon(totals.paymentVat - totals.refundVat)} · 공급가액 ${formatWon(totals.paymentAmount - totals.paymentVat - (totals.refundAmount - totals.refundVat))}`} />
                </AdminMetricGrid>
                <AdminDataTable caption="결제수단별 결제" columns={breakdownColumns} rows={mergeBreakdowns(charge.days, 'byMethod')}
                  getRowKey={(row) => row.key} state={charge.days.some((day) => day.paymentCount > 0) ? undefined : <AdminTableState kind="empty" message="이 기간 결제가 없습니다." />} />
                <AdminDataTable caption="환불 경위별" columns={breakdownColumns} rows={mergeBreakdowns(charge.days, 'refundByOrigin')}
                  getRowKey={(row) => row.key} state={charge.days.some((day) => day.refundCount > 0) ? undefined : <AdminTableState kind="empty" message="이 기간 환불이 없습니다." />} />
              </>
            ) : (
              <AdminTableState kind="error" message="결제 기준 숫자를 낼 수 없습니다." />
            )}
          </Section>

          <Section title="크레딧 흐름(운영 참고)">
            {content ? <p className="text-sm text-[var(--studio-muted)]">{content.creditNotice}</p> : null}
            <AdminDataTable caption="크레딧 흐름" columns={creditColumns} rows={buildCreditRows(overview.credit)} getRowKey={(row, index) => `${row.line}-${index}`} dense />
          </Section>

          <Section title="사용분 참고 금액(원)">
            {content ? <p className="text-sm text-[var(--studio-muted)]">{content.usageNotice}</p> : null}
            <AdminDataTable caption="사용분 참고 금액" columns={usageColumns} rows={buildUsageRows(overview.usage)} getRowKey={(row, index) => `${row.section}-${index}`} dense />
          </Section>
        </>
      ) : null}

      {isOwner && content ? (
        <Section title="CSV 안내 문구(대표)">
          <ContentEditor content={content} />
        </Section>
      ) : null}
    </div>
  )
}
