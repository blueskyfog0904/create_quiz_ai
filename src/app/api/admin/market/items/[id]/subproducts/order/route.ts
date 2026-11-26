import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { marketItemOptionErrorMessage } from '@/lib/market-item-options'
import { callReorderMarketItemSubproducts, isProductInfoPreviewEnabled } from '@/lib/market-item-options-server'
import { isMarketItemInSubject } from '@/lib/market-item-usage-basis-server'

// 19번 5절: 상품의 서브상품 순서 저장(상품 저장과 따로). products.edit. 쓰기는 DB 함수 reorder_market_item_subproducts 만(같은 거래에서 작업 기록).
// 서브상품 공개 읽기는 캐시가 없어 갱신할 태그가 없다(상세가 요청마다 읽음).
export const dynamic = 'force-dynamic'

// 가드 거절 본문(이 폴더 route 들의 기존 형식: 401 UNAUTHORIZED·403 FORBIDDEN·500 INTERNAL_SERVER_ERROR)
function guardErrorBody(guard: { error: string; status: number }) {
  const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
  return { success: false, error: { code, message: adminApiGuardMessage(guard) } }
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const OrderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
})

export async function PUT(request: Request, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }
  if (isProductInfoPreviewEnabled()) {
    return NextResponse.json({ success: false, error: { code: 'PREVIEW', message: '미리보기에서는 저장하지 않습니다.' } }, { status: 409 })
  }

  const { id } = await params
  const parsed = OrderSchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '입력이 올바르지 않습니다.' } }, { status: 400 })
  }
  // 상품이 없거나 주소의 과목과 다르면 404(다른 과목 메뉴에서 저장하지 않게)
  try {
    if (!(await isMarketItemInSubject(id, resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))))) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }
  } catch (error) {
    console.error('[subproducts/order] 상품 확인 실패', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
  }

  const result = await callReorderMarketItemSubproducts(guard.access.userId, id, parsed.data.ids, adminRequestMeta(request))
  if (!result.ok) {
    if (!result.error) {
      return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '순서를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
    }
    const status = result.error.code === 'MARKET_CATALOG_ACTOR_NOT_ALLOWED' ? 403
      : result.error.code === 'MARKET_ITEM_NOT_FOUND' ? 404
        : result.error.code === 'MARKET_SUBPRODUCT_REORDER_MISMATCH' ? 409 : 400
    return NextResponse.json({ success: false, error: { code: result.error.code, message: marketItemOptionErrorMessage(result.error) } }, { status })
  }
  return NextResponse.json({ success: true, data: result.data })
}
