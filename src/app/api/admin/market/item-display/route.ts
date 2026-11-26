import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import {
  MARKET_ITEM_DETAIL_LONG_KEYS,
  MARKET_ITEM_DETAIL_SHORT_KEYS,
  MARKET_ITEM_DISPLAY_CACHE_TAG,
  MARKET_ITEM_FACET_KEYS,
  MARKET_ITEM_INFO_KEYS,
  MARKET_ITEM_SUMMARY_LABEL_KEYS,
  findMarketItemDetailDisplayProblem,
  findMarketItemDisplayProblem,
  marketItemOptionErrorMessage,
  type MarketItemDetailTextKey,
  type MarketItemFacetKey,
  type MarketItemSummaryLabelKey,
} from '@/lib/market-item-options'
import { callSaveMarketItemDisplay, isProductInfoPreviewEnabled, type MarketItemDisplayPatch } from '@/lib/market-item-options-server'

// 17번 7-1: 상품 표시 설정(검색·자료 보관함 필터 이름, 국어·영어 공통 1행). products.edit. 쓰기는 DB 함수만.
// 19번 4-3: 탭마다 자기 키만 보낸다 — [검색 필터 이름]은 facetLabels·libraryEmptyFilterHint 둘 다, [상세 안내 문구]·[자료 정보 항목]은 detail.
export const dynamic = 'force-dynamic'

// 가드 거절 본문(이 폴더 route 들의 기존 형식: 401 UNAUTHORIZED·403 FORBIDDEN·500 INTERNAL_SERVER_ERROR)
function guardErrorBody(guard: { error: string; status: number }) {
  const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
  return { success: false, error: { code, message: adminApiGuardMessage(guard) } }
}

const DetailSchema = z.object({
  ...(Object.fromEntries([...MARKET_ITEM_DETAIL_SHORT_KEYS, ...MARKET_ITEM_DETAIL_LONG_KEYS].map((key) => [key, z.string()])) as Record<MarketItemDetailTextKey, z.ZodString>),
  summaryLabels: z.object(Object.fromEntries(MARKET_ITEM_SUMMARY_LABEL_KEYS.map((key) => [key, z.string()])) as Record<MarketItemSummaryLabelKey, z.ZodString>),
  infoItems: z.array(z.object({ key: z.enum(MARKET_ITEM_INFO_KEYS), label: z.string(), visible: z.boolean() })),
})

const DisplaySchema = z.object({
  expectedRevision: z.number().int().min(1),
  facetLabels: z.object(Object.fromEntries(MARKET_ITEM_FACET_KEYS.map((key) => [key, z.string()])) as Record<MarketItemFacetKey, z.ZodString>).optional(),
  libraryEmptyFilterHint: z.string().optional(),
  detail: DetailSchema.optional(),
}).refine((value) => (value.facetLabels === undefined) === (value.libraryEmptyFilterHint === undefined)
  && (value.facetLabels !== undefined || value.detail !== undefined))

export async function PUT(request: Request) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }
  if (isProductInfoPreviewEnabled()) {
    return NextResponse.json({ success: false, error: { code: 'PREVIEW', message: '미리보기에서는 저장하지 않습니다.' } }, { status: 409 })
  }

  const parsed = DisplaySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: '입력이 올바르지 않습니다.' } }, { status: 400 })
  }
  const value: MarketItemDisplayPatch = {}
  if (parsed.data.facetLabels !== undefined && parsed.data.libraryEmptyFilterHint !== undefined) {
    value.facetLabels = parsed.data.facetLabels
    value.libraryEmptyFilterHint = parsed.data.libraryEmptyFilterHint
  }
  if (parsed.data.detail !== undefined) value.detail = parsed.data.detail
  const problem = (value.facetLabels && value.libraryEmptyFilterHint !== undefined
    ? findMarketItemDisplayProblem({ facetLabels: value.facetLabels, libraryEmptyFilterHint: value.libraryEmptyFilterHint })
    : null) ?? (value.detail ? findMarketItemDetailDisplayProblem(value.detail) : null)
  if (problem) {
    return NextResponse.json({
      success: false,
      error: { code: 'MARKET_ITEM_DISPLAY_INPUT_INVALID', message: marketItemOptionErrorMessage({ code: 'MARKET_ITEM_DISPLAY_INPUT_INVALID', detail: problem }) },
    }, { status: 400 })
  }

  const result = await callSaveMarketItemDisplay(guard.access.userId, parsed.data.expectedRevision, value, adminRequestMeta(request))
  if (!result.ok) {
    if (!result.error) {
      return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
    }
    const status = result.error.code === 'MARKET_CATALOG_ACTOR_NOT_ALLOWED' ? 403 : result.error.code === 'MARKET_ITEM_DISPLAY_REVISION_CONFLICT' ? 409 : 400
    return NextResponse.json({ success: false, error: { code: result.error.code, message: marketItemOptionErrorMessage(result.error) } }, { status })
  }
  if (result.data.changed === true) revalidateTag(MARKET_ITEM_DISPLAY_CACHE_TAG, { expire: 0 })
  return NextResponse.json({ success: true, data: result.data })
}
