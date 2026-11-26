import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_USAGE_BASIS_EVIDENCE_MAX, MARKET_USAGE_BASIS_NOTE_MAX, marketItemOptionErrorMessage } from '@/lib/market-item-options'
import { isProductInfoPreviewEnabled } from '@/lib/market-item-options-server'
import { callSaveMarketItemUsageBasis, isMarketItemInSubject, readMarketItemUsageBasisForAdmin } from '@/lib/market-item-usage-basis-server'

// 17번 7-2: 상품별 원저작물 이용 근거(내부 전용 — 회원 경로에는 없다). 읽기·저장 모두 products.edit(Q6). 저장은 DB 함수만.
export const dynamic = 'force-dynamic'

// 가드 거절 본문(이 폴더 route 들의 기존 형식: 401 UNAUTHORIZED·403 FORBIDDEN·500 INTERNAL_SERVER_ERROR)
function guardErrorBody(guard: { error: string; status: number }) {
  const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
  return { success: false, error: { code, message: adminApiGuardMessage(guard) } }
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const SaveSchema = z.object({
  expectedRevision: z.number().int().min(1).nullable(),
  basisOptionId: z.string().uuid(),
  // 글자 수는 DB 함수가 다듬은 뒤 다시 본다(여기서는 터무니없이 긴 요청만 막음)
  note: z.string().max(MARKET_USAGE_BASIS_NOTE_MAX * 2),
  evidenceRef: z.string().max(MARKET_USAGE_BASIS_EVIDENCE_MAX * 2),
})

const isUuid = (value: string) => z.string().uuid().safeParse(value).success

export async function GET(request: Request, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }

  const { id } = await params
  if (!isUuid(id)) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
  }
  try {
    const data = await readMarketItemUsageBasisForAdmin(id, resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject')))
    if (!data) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[usage-basis] 읽기 실패', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '이용 근거를 불러오지 못했습니다.' } }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }
  if (isProductInfoPreviewEnabled()) {
    return NextResponse.json({ success: false, error: { code: 'PREVIEW', message: '미리보기에서는 저장하지 않습니다.' } }, { status: 409 })
  }

  const { id } = await params
  const parsed = SaveSchema.safeParse(await request.json().catch(() => null))
  if (!isUuid(id) || !parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '입력이 올바르지 않습니다.' } }, { status: 400 })
  }
  // GET 과 같게: 상품이 없거나 주소의 과목과 다르면 404(다른 과목 메뉴에서 저장하지 않게)
  try {
    if (!(await isMarketItemInSubject(id, resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))))) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }
  } catch (error) {
    console.error('[usage-basis] 상품 확인 실패', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
  }
  const result = await callSaveMarketItemUsageBasis(guard.access.userId, id, parsed.data, adminRequestMeta(request))
  if (!result.ok) {
    if (!result.error) {
      return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
    }
    const status = result.error.code === 'MARKET_CATALOG_ACTOR_NOT_ALLOWED' ? 403
      : result.error.code === 'MARKET_ITEM_NOT_FOUND' ? 404
        : result.error.code === 'MARKET_USAGE_BASIS_REVISION_CONFLICT' ? 409 : 400
    return NextResponse.json({ success: false, error: { code: result.error.code, message: marketItemOptionErrorMessage(result.error) } }, { status })
  }
  return NextResponse.json({ success: true, data: result.data })
}
