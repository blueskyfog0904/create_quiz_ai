'use server'

import { headers } from 'next/headers'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import {
  SALES_REPORT_CONTENT_SETTING_KEY,
  validateSalesReportContentInput,
  type SalesReportContent,
  type SalesReportContentInput,
} from '@/lib/sales-report'
import { readSalesReportContent, saveSalesReportContent } from '@/lib/sales-report-server'

// 23번 4-2·8절: 매출 CSV 머리 문구·화면 안내 수정(대표만). 순서: 가드 → 지금 값 → revision 비교·값 검사 → 저장(서버 키) → 작업 기록.
// 작업 기록에는 바뀐 칸과 글자 수만 남긴다. 결과는 객체로 돌려준다(던진 오류 글은 운영에서 가려진다).
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean }

const CONFLICT_MESSAGE = '다른 곳에서 먼저 저장했습니다. 화면을 새로고침해 최신 문구를 확인한 뒤 다시 저장해 주세요.'

export async function saveSalesReportContentAction(input: SalesReportContentInput): Promise<ActionResult<SalesReportContent>> {
  const access = await assertAdminActionPermission('owner')
  let current: SalesReportContent
  try {
    current = await readSalesReportContent()
  } catch {
    return { ok: false, error: '지금 저장된 문구를 읽지 못해 저장하지 않았습니다.' }
  }
  const checked = validateSalesReportContentInput(input, current)
  if (!checked.ok) {
    return checked.error === 'REVISION_CONFLICT' ? { ok: false, conflict: true, error: CONFLICT_MESSAGE } : { ok: false, error: checked.error }
  }
  if (checked.changedKeys.length === 0) return { ok: true, data: current }

  let saved: boolean
  try {
    saved = await saveSalesReportContent(checked.content, current.revision)
  } catch {
    return { ok: false, error: '문구를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  if (!saved) return { ok: false, conflict: true, error: CONFLICT_MESSAGE }

  await recordAdminAudit({
    actorId: access.userId,
    action: 'sales_report_content_update',
    targetType: 'system_settings',
    targetId: SALES_REPORT_CONTENT_SETTING_KEY,
    details: {
      revision: checked.content.revision,
      changedKeys: checked.changedKeys,
      lengths: Object.fromEntries(checked.changedKeys.map((key) => [key, checked.content[key].length])),
      request: adminRequestMeta(await headers()),
    },
  })
  return { ok: true, data: checked.content }
}
