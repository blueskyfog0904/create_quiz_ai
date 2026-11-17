import { NextResponse } from 'next/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { retryMarketStorageCleanup } from '@/lib/market-storage-cleanup'

export const dynamic = 'force-dynamic'

// 상품 파일 정리는 상품 등록·수정 권한(products.edit)으로 다룬다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser() {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status })
  }
  return null
}

// 지우지 못한 파일을 다시 정리한다.
export async function POST() {
  const denied = await requireAdminUser()
  if (denied) return denied

  try {
    const result = await retryMarketStorageCleanup()
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : '파일 정리에 실패했습니다.' },
    }, { status: 500 })
  }
}
