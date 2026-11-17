import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  disableMarketItemBundleOption,
  getMarketItemBundleOptionForAdmin,
  getMarketItemById,
  upsertMarketItemBundleOption,
} from '@/lib/market-items-server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'

export const dynamic = 'force-dynamic'

const BundleOptionSchema = z.object({
  label: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  priceCredits: z.number().int().min(0),
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

    const bundleOption = await getMarketItemBundleOptionForAdmin(id, workspaceSubject)
    return NextResponse.json({ success: true, data: bundleOption })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '전체구매 옵션을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()
  const { id } = await params
  const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))

  if (denied) {
    return denied
  }

  try {
    const parsed = BundleOptionSchema.safeParse(await request.json())
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

    const bundleOption = await upsertMarketItemBundleOption(id, {
      workspaceSubject,
      label: parsed.data.label,
      description: parsed.data.description,
      priceCredits: parsed.data.priceCredits,
      isActive: parsed.data.isActive,
    })

    return NextResponse.json({ success: true, data: bundleOption })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '전체구매 옵션 저장에 실패했습니다.',
      },
    }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
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

    await disableMarketItemBundleOption(id, workspaceSubject)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '전체구매 옵션 비활성화에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
