import { NextResponse } from 'next/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { deleteMarketSubproductFile, getMarketItemById } from '@/lib/market-items-server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; subproductId: string; fileId: string }>
}

// 상품 등록·수정 권한(products.edit)을 공용 가드로 확인한다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'products.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id, subproductId, fileId } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (denied) {
    return denied
  }

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    await deleteMarketSubproductFile(id, subproductId, fileId, workspaceSubject)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 파일 삭제에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
