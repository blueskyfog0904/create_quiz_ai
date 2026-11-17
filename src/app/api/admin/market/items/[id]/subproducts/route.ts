import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  createMarketItemSubproduct,
  getMarketItemById,
  listMarketItemSubproductsForAdmin,
} from '@/lib/market-items-server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'

export const dynamic = 'force-dynamic'

const SubproductSchema = z.object({
  categoryId: z.string().uuid(),
  description: z.string().trim().optional().nullable(),
  purchaseNoticeLabel: z.string().trim().max(24).optional().nullable(),
  purchaseNoticeText: z.string().trim().max(160).optional().nullable(),
  priceCredits: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
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

export async function GET(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (denied) {
    return denied
  }

  try {
    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const subproducts = await listMarketItemSubproductsForAdmin(id, workspaceSubject)
    return NextResponse.json({ success: true, data: subproducts })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 목록을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (denied) {
    return denied
  }

  try {
    const parsed = SubproductSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const item = await getMarketItemById(id, workspaceSubject)
    if (!item) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 상품을 찾을 수 없습니다.' } }, { status: 404 })
    }

    const subproduct = await createMarketItemSubproduct({
      itemId: id,
      workspaceSubject,
      categoryId: parsed.data.categoryId,
      description: parsed.data.description,
      purchaseNoticeLabel: parsed.data.purchaseNoticeLabel,
      purchaseNoticeText: parsed.data.purchaseNoticeText,
      priceCredits: parsed.data.priceCredits,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
    })

    return NextResponse.json({ success: true, data: subproduct }, { status: 201 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '서브상품 생성에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
