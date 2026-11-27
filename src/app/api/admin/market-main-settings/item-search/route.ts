import { NextResponse } from 'next/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { searchMarketHomeItems } from '@/lib/market-home-server'
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

// 홈 진열 추천 상품 고르기(22번 3-2): 같은 과목 상품의 제목·id·상태·대표 그림만 준다(회원 정보 없음).
export async function GET(request: Request) {
  const { denied } = await requireAdminUser()
  if (denied) return denied

  const url = new URL(request.url)
  const subject = url.searchParams.get('subject')
  if (!isWorkspaceSubject(subject)) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '과목은 english 또는 korean이어야 합니다.' } }, { status: 400 })
  }

  try {
    const items = await searchMarketHomeItems(subject, url.searchParams.get('q') ?? '')
    return NextResponse.json({ success: true, data: { items } })
  } catch (error) {
    console.error('[market-home] 추천 상품 검색에 실패했습니다.', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: '상품을 찾지 못했습니다.' } }, { status: 500 })
  }
}
