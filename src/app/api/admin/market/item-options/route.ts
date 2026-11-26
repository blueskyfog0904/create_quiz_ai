import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MARKET_PUBLIC_LIST_CACHE_TAG } from '@/lib/market-images'
import {
  MARKET_ITEM_OPTIONS_CACHE_TAG,
  MARKET_ITEM_OPTION_KINDS,
  MARKET_ITEM_OPTION_LABEL_MAX,
  marketItemOptionErrorMessage,
  type MarketItemOptionErrorCode,
} from '@/lib/market-item-options'
import {
  callReorderMarketItemOptions,
  callSaveMarketItemOption,
  isProductInfoPreviewEnabled,
  readMarketItemOptionsWithCounts,
  type MarketCatalogCallResult,
} from '@/lib/market-item-options-server'

// 17번 7-1: 상품 학년·자료유형·이용 근거 목록(과목별). 읽기·저장·순서 모두 products.edit. 쓰기는 DB 함수만(같은 거래에서 작업 기록).
export const dynamic = 'force-dynamic'

// 가드 거절 본문(이 폴더 route 들의 기존 형식: 401 UNAUTHORIZED·403 FORBIDDEN·500 INTERNAL_SERVER_ERROR)
function guardErrorBody(guard: { error: string; status: number }) {
  const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
  return { success: false, error: { code, message: adminApiGuardMessage(guard) } }
}

const KindSchema = z.enum(MARKET_ITEM_OPTION_KINDS)

const SaveSchema = z.object({
  id: z.string().uuid().nullable(),
  expectedRevision: z.number().int().min(1).nullable(),
  kind: KindSchema,
  label: z.string().max(MARKET_ITEM_OPTION_LABEL_MAX * 4),
  isActive: z.boolean(),
})

const ReorderSchema = z.object({
  kind: KindSchema,
  ids: z.array(z.string().uuid()).min(1).max(200),
})

const STATUS_BY_CODE: Partial<Record<MarketItemOptionErrorCode, number>> = {
  MARKET_CATALOG_ACTOR_NOT_ALLOWED: 403,
  MARKET_OPTION_NOT_FOUND: 404,
  MARKET_OPTION_REVISION_CONFLICT: 409,
  MARKET_OPTION_DUPLICATE: 409,
  MARKET_OPTION_REORDER_MISMATCH: 409,
}

function failure(result: Extract<MarketCatalogCallResult, { ok: false }>) {
  if (!result.error) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 })
  }
  return NextResponse.json({
    success: false,
    error: { code: result.error.code, message: marketItemOptionErrorMessage(result.error) },
  }, { status: STATUS_BY_CODE[result.error.code] ?? 400 })
}

const invalidInput = (message = '입력이 올바르지 않습니다.') =>
  NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message } }, { status: 400 })

const previewRefusal = () =>
  NextResponse.json({ success: false, error: { code: 'PREVIEW', message: '미리보기에서는 저장하지 않습니다.' } }, { status: 409 })

export async function GET(request: Request) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }

  const searchParams = new URL(request.url).searchParams
  const kind = KindSchema.safeParse(searchParams.get('kind'))
  if (!kind.success) return invalidInput()
  try {
    const options = await readMarketItemOptionsWithCounts(resolveAdminWorkspaceSubject(searchParams.get('subject')), kind.data)
    return NextResponse.json({ success: true, data: options })
  } catch (error) {
    console.error('[item-options] 읽기 실패', error instanceof Error ? error.message : error)
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: '목록을 불러오지 못했습니다.' } }, { status: 500 })
  }
}

// 항목 저장(새 항목 id null). 이름을 바꾸면 DB 함수가 그 이름을 쓰는 상품도 바꾼다 → 공개 목록 캐시(검색·홈)도 내린다.
export async function POST(request: Request) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }
  if (isProductInfoPreviewEnabled()) return previewRefusal()

  const parsed = SaveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return invalidInput()
  const subject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
  const result = await callSaveMarketItemOption(guard.access.userId, {
    id: parsed.data.id,
    expectedRevision: parsed.data.expectedRevision,
    subject,
    kind: parsed.data.kind,
    label: parsed.data.label,
    isActive: parsed.data.isActive,
  }, adminRequestMeta(request))
  if (!result.ok) return failure(result)

  const renamedItemCount = typeof result.data.renamedItemCount === 'number' ? result.data.renamedItemCount : 0
  if (result.data.changed === true) revalidateTag(MARKET_ITEM_OPTIONS_CACHE_TAG, { expire: 0 })
  if (renamedItemCount > 0) revalidateTag(MARKET_PUBLIC_LIST_CACHE_TAG, { expire: 0 })
  return NextResponse.json({ success: true, data: result.data })
}

// 순서 저장: id 집합이 그 과목·종류 전체(숨김 포함)와 같아야 한다.
export async function PUT(request: Request) {
  const guard = await requireAdminApiPermission('products.edit')
  if ('error' in guard) {
    return NextResponse.json(guardErrorBody(guard), { status: guard.status })
  }
  if (isProductInfoPreviewEnabled()) return previewRefusal()

  const parsed = ReorderSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return invalidInput()
  const subject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
  const result = await callReorderMarketItemOptions(guard.access.userId, subject, parsed.data.kind, parsed.data.ids, adminRequestMeta(request))
  if (!result.ok) return failure(result)
  if (result.data.changed === true) revalidateTag(MARKET_ITEM_OPTIONS_CACHE_TAG, { expire: 0 })
  return NextResponse.json({ success: true, data: result.data })
}
