import { NextRequest, NextResponse } from 'next/server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { isSalesReportKind, resolveSalesReportPeriod, salesReportFileName } from '@/lib/sales-report'
import { SalesReportUnavailableError, buildSalesReportFile } from '@/lib/sales-report-server'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

// 23번 5-2: 매출·정산 기본 CSV 내려받기(회원 칸 없음 — 4-1 열 허용 목록). reports.view(orders.view 함께 필요).
// 순서: 쿼리 → 파일 만들기 → sha256 → 작업 기록(실패면 500, 파일 없음) → 응답. 파일은 서버에 저장하지 않는다.
export async function GET(request: NextRequest) {
  const guard = await requireAdminApiPermission('reports.view')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status, headers: NO_STORE })
  }

  const searchParams = new URL(request.url).searchParams
  const kind = searchParams.get('kind')
  if (!isSalesReportKind(kind)) {
    return NextResponse.json({ error: '내려받을 파일 종류가 올바르지 않습니다.' }, { status: 400, headers: NO_STORE })
  }
  const resolved = resolveSalesReportPeriod({ from: searchParams.get('from'), to: searchParams.get('to') })
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400, headers: NO_STORE })
  }
  const { period } = resolved

  let file: Awaited<ReturnType<typeof buildSalesReportFile>>
  try {
    file = await buildSalesReportFile(kind, period)
  } catch (error) {
    if (error instanceof SalesReportUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409, headers: NO_STORE })
    }
    console.error('[sales-report] CSV 를 만들지 못했습니다.', { kind, message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }

  // 파일을 주기 전에 지문을 작업 기록에 남긴다(Q8). 남기지 못하면 파일을 주지 않는다.
  const recorded = await recordAdminAudit({
    actorId: guard.access.userId,
    action: 'sales_report_export',
    targetType: 'sales_report',
    targetId: kind,
    details: {
      kind,
      from: period.fromDate,
      to: period.toDate,
      definition_version: file.definitionVersion,
      row_count: file.rowCount,
      totals: file.totals,
      sha256: file.sha256,
      request: adminRequestMeta(request),
    },
  })
  if (!recorded) {
    return NextResponse.json({ error: '내려받은 기록을 남기지 못해 파일을 주지 않았습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }

  return new NextResponse(file.csv, {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${salesReportFileName(kind, period)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
