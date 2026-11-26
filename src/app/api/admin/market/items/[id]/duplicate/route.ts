import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_ITEM_DUPLICATE_ERROR_MESSAGES, MARKET_ITEM_DUPLICATE_MODES } from '@/lib/market-item-duplicate'
import { callDuplicateMarketItem } from '@/lib/market-item-duplicate-server'

// 18번 7절: 상품 복제(목록 [복제] = copy)·같은 구성으로 다음 상품(next). products.edit. 새 상품은 늘 임시저장이라
// 공개 목록 캐시는 갱신하지 않는다. 과목은 주소(?subject)에서 정하고 DB 함수가 원본 workspace_subject 와 대조한다.
export const dynamic = 'force-dynamic'

function guardErrorBody(guard: { error: string; status: number }) {
  const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
  return { success: false, error: { code, message: adminApiGuardMessage(guard) } }
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const DuplicateSchema = z.object({ mode: z.enum(MARKET_ITEM_DUPLICATE_MODES) })

export async function POST(request: Request, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }

  const { id } = await params
  const parsed = DuplicateSchema.safeParse(await request.json().catch(() => null))
  if (!z.string().uuid().safeParse(id).success || !parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '입력이 올바르지 않습니다.' } }, { status: 400 })
  }

  const subject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
  try {
    const result = await callDuplicateMarketItem(guard.access.userId, subject, id, parsed.data.mode, adminRequestMeta(request))
    if (!result.ok) {
      if (!result.error) {
        return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '복제하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
      }
      const status = result.error === 'MARKET_CATALOG_ACTOR_NOT_ALLOWED' ? 403 : result.error === 'MARKET_DUPLICATE_SOURCE_NOT_FOUND' ? 404 : 400
      return NextResponse.json({ success: false, error: { code: result.error, message: MARKET_ITEM_DUPLICATE_ERROR_MESSAGES[result.error] } }, { status })
    }
    return NextResponse.json({ success: true, data: result.data })
  } catch (error) {
    console.error('[duplicate] 복제 실패', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '복제하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
  }
}
