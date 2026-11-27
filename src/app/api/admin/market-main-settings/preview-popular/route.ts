import { NextResponse } from 'next/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { MARKET_HOME_LIMITS } from '@/lib/market-home'
import { getMarketHomePopularPreview } from '@/lib/market-home-server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

// 홈 화면 광고·진열 권한(storefront.edit)을 공용 가드로 확인한다. 오류 응답은 홈 진열 route 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'storefront.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

function invalid(message: string) {
  return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message } }, { status: 400 })
}

// 홈 진열 미리보기(22번 17절): 저장 전 기간 버튼의 일수 → 회원 홈과 같은 집계의 인기 순위(공개 카드 정보만, 상한 24개).
export async function POST(request: Request) {
  const { denied } = await requireAdminUser()
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return invalid('입력 형식이 올바르지 않습니다.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid('입력 형식이 올바르지 않습니다.')
  const { subject, days } = body as Record<string, unknown>
  if (typeof subject !== 'string' || !isWorkspaceSubject(subject)) return invalid('과목은 english 또는 korean이어야 합니다.')
  const range = MARKET_HOME_LIMITS.rankingWindowDays
  if (!Number.isInteger(days) || (days as number) < range.min || (days as number) > range.max) {
    return invalid(`집계 기간은 ${range.min}~${range.max} 사이 정수여야 합니다.`)
  }

  try {
    const items = await getMarketHomePopularPreview(subject, days as number)
    return NextResponse.json({ success: true, data: { days, items } })
  } catch (error) {
    console.error('[market-home] 인기 순위 미리보기에 실패했습니다.', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: '미리보기를 읽지 못했습니다.' } }, { status: 500 })
  }
}
