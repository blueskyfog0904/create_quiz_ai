import type { Metadata } from 'next'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { resolveSalesReportPeriod, salesReportMonthRange } from '@/lib/sales-report'
import { getSalesReportOverview, readSalesReportContent, type SalesReportOverview } from '@/lib/sales-report-server'
import { SalesReportClient } from './sales-report-client'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/reports',
    fallbackName: '매출·정산',
    searchParams,
    description: '기간별 결제 기준 매출·크레딧 흐름을 보고 CSV 로 내려받습니다.',
  })
}

interface AdminReportsPageProps {
  searchParams?: Promise<{ from?: string; to?: string }>
}

// 23번 묶음(계획 5-4·6절): 매출·정산 요약과 CSV 4종. 숫자는 DB 보고 함수(읽기 전용)만 쓴다. 기간은 주소의 from·to(한국 날짜), 없으면 이번 달.
export default async function AdminReportsPage({ searchParams }: AdminReportsPageProps) {
  const access = await requireAdminPagePermission('reports.view')
  const params = searchParams ? await searchParams : undefined
  const fallback = salesReportMonthRange()
  const resolved = resolveSalesReportPeriod({ from: params?.from ?? fallback.from, to: params?.to ?? fallback.to })
  const title = <AdminMenuName href="/admin/reports" fallback="매출·정산" />

  if (!resolved.ok) {
    return (
      <div>
        <AdminPageHeader title={title} />
        <AdminNotice kind="error" title="기간을 읽지 못했습니다">{resolved.error}</AdminNotice>
        <SalesReportClient period={null} overview={null} content={null} isOwner={false} loadError={null} />
      </div>
    )
  }

  let overview: SalesReportOverview | null = null
  let content: Awaited<ReturnType<typeof readSalesReportContent>> | null = null
  let loadError: string | null = null
  try {
    ;[overview, content] = await Promise.all([getSalesReportOverview(resolved.period), readSalesReportContent()])
  } catch (error) {
    console.error('[sales-report] 요약을 읽지 못했습니다.', error instanceof Error ? error.message : String(error))
    loadError = '매출 요약을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }

  return (
    <div>
      <AdminPageHeader
        title={title}
        description="결제 기준 매출과 크레딧 흐름을 기간별로 봅니다. 조회만 하고 기록은 바꾸지 않습니다."
        meta={`한국 시간 기준 · ${resolved.period.fromDate} ~ ${resolved.period.toDate}${content ? ` · 정의 판 ${content.definitionVersion}` : ''}`}
      />
      <SalesReportClient
        period={resolved.period}
        overview={overview}
        content={content}
        isOwner={hasAdminPermission(access, 'owner')}
        loadError={loadError}
      />
    </div>
  )
}
