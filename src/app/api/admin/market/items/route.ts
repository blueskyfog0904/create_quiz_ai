import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getMarketCategoryItemWorkspaceSubject, listMarketCategorySubtreeIdsForAdmin } from '@/lib/market-categories-server'
import { createMarketItem, listMarketItemsForAdmin } from '@/lib/market-items-server'
import { MARKET_IMAGE_NOT_FOUND_MESSAGE, isMarketImageReferenceError } from '@/lib/market-images-server'
import { MARKET_CATEGORY_TREE_CACHE_TAG, MARKET_PUBLIC_LIST_CACHE_TAG } from '@/lib/market-images'
import { MARKET_ITEM_SOURCE_MAX } from '@/lib/market-item-options'
import { findMarketItemProductOptionProblem } from '@/lib/market-item-options-server'

export const dynamic = 'force-dynamic'

// 17번: 출처 1~4 는 각 0~100자(빈 값은 NULL). 학년·자료유형은 과목별 DB 목록에서 고른 값만(지금 값과 같으면 통과).
const SOURCE_TOO_LONG = `출처는 칸마다 ${MARKET_ITEM_SOURCE_MAX}자 이하로 입력해 주세요.`

const MarketItemSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().optional(),
  description: z.string().trim().optional(),
  // undefined = 변경 없음, null = 이미지 해제
  thumbnailImageId: z.string().uuid().nullable().optional(),
  examYear: z.number().int().nullable().optional(),
  examMonth: z.number().int().min(1).max(12).nullable().optional(),
  gradeLevel: z.string().trim().optional(),
  sourceType: z.string().trim().optional(),
  source1: z.string().trim().max(MARKET_ITEM_SOURCE_MAX, SOURCE_TOO_LONG).optional(),
  source2: z.string().trim().max(MARKET_ITEM_SOURCE_MAX, SOURCE_TOO_LONG).optional(),
  source3: z.string().trim().max(MARKET_ITEM_SOURCE_MAX, SOURCE_TOO_LONG).optional(),
  source4: z.string().trim().max(MARKET_ITEM_SOURCE_MAX, SOURCE_TOO_LONG).optional(),
  questionCount: z.number().int().min(0).nullable().optional(),
  // 필수. 상품 과목은 이 칸의 과목으로 정한다.
  categoryItemId: z.string({ error: '카테고리를 선택해주세요.' }).uuid('카테고리를 선택해주세요.'),
  pdfPrice: z.number().int().min(0),
  hwpPrice: z.number().int().min(0),
  zipPrice: z.number().int().min(0),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(['draft', 'published', 'hidden', 'archived']).optional(),
  draftSource: z.enum(['manual', 'auto_upload']).optional(),
  isActive: z.boolean().optional(),
})

// 상품 등록·수정 권한(products.edit)을 공용 가드로 확인한다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'products.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

export async function GET(request: Request) {
  const { denied } = await requireAdminUser()

  if (denied) {
    return denied
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))
    // ?categoryId=: 그 칸과 하위 칸 전체의 상품
    const categoryId = searchParams.get('categoryId')
    const categoryIds = categoryId ? await listMarketCategorySubtreeIdsForAdmin(workspaceSubject, categoryId) : undefined
    const items = await listMarketItemsForAdmin({ workspaceSubject, categoryIds })

    return NextResponse.json({ success: true, data: items })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품 목록을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { user, denied } = await requireAdminUser()

  if (denied) {
    return denied
  }

  try {
    const body = await request.json()
    const parsed = MarketItemSchema.safeParse(body)
    const requestedSubject = new URL(request.url).searchParams.get('subject')

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    // 상품 과목 = 카테고리 칸의 과목. 요청에 과목(?subject=)이 있으면 같아야 한다.
    const workspaceSubject = await getMarketCategoryItemWorkspaceSubject(parsed.data.categoryItemId)
    if (!workspaceSubject || (requestedSubject !== null && resolveAdminWorkspaceSubject(requestedSubject) !== workspaceSubject)) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '상품과 같은 과목의 카테고리를 선택해주세요.' },
      }, { status: 400 })
    }

    // 학년·자료유형은 그 과목의 사용 중 목록에 있어야 한다(캐시 없이 DB 에서 읽음).
    const optionProblem = await findMarketItemProductOptionProblem(workspaceSubject, {
      gradeLevel: parsed.data.gradeLevel,
      sourceType: parsed.data.sourceType,
    }, null)
    if (optionProblem) {
      return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: optionProblem } }, { status: 400 })
    }

    const item = await createMarketItem({
      workspace_subject: workspaceSubject,
      title: parsed.data.title,
      summary: parsed.data.summary,
      description: parsed.data.description,
      thumbnail_image_id: parsed.data.thumbnailImageId,
      exam_year: parsed.data.examYear ?? null,
      exam_month: parsed.data.examMonth ?? null,
      grade_level: parsed.data.gradeLevel,
      source_type: parsed.data.sourceType,
      source_1: parsed.data.source1,
      source_2: parsed.data.source2,
      source_3: parsed.data.source3,
      source_4: parsed.data.source4,
      question_count: parsed.data.questionCount ?? null,
      category_item_id: parsed.data.categoryItemId,
      pdf_price: parsed.data.pdfPrice,
      hwp_price: parsed.data.hwpPrice,
      zip_price: parsed.data.zipPrice,
      sort_order: parsed.data.sortOrder ?? 0,
      status: parsed.data.status ?? 'draft',
      draft_source: parsed.data.draftSource,
      is_active: parsed.data.isActive ?? true,
      created_by: user.id,
      updated_by: user.id,
    })

    // 이미지를 지정해 만들면 공개 목록 캐시(홈·보드)를 바로 갱신한다.
    if (parsed.data.thumbnailImageId) revalidateTag(MARKET_PUBLIC_LIST_CACHE_TAG, { expire: 0 })
    // 공개 상품으로 만들면 칸별 상품 수가 바뀐다.
    if (parsed.data.status === 'published') revalidateTag(MARKET_CATEGORY_TREE_CACHE_TAG, { expire: 0 })

    return NextResponse.json({ success: true, data: item }, { status: 201 })
  } catch (error) {
    if (isMarketImageReferenceError(error)) {
      return NextResponse.json({
        success: false,
        error: { code: 'IMAGE_NOT_FOUND', message: MARKET_IMAGE_NOT_FOUND_MESSAGE },
      }, { status: 404 })
    }
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 상품 생성에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
