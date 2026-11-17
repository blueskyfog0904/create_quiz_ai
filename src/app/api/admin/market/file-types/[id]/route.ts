import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  deleteMarketFileType,
  updateMarketFileType,
} from '@/lib/market-items-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

const FileTypePatchSchema = z.object({
  code: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  extension: z.string().trim().min(1).optional(),
  mimeAllowlist: z.array(z.string().trim().min(1)).optional(),
  sortOrder: z.number().int().min(0).optional(),
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

export async function PATCH(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()

  if (denied) {
    return denied
  }

  try {
    const parsed = FileTypePatchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const { id } = await params
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const fileType = await updateMarketFileType(id, {
      workspaceSubject,
      code: parsed.data.code,
      label: parsed.data.label,
      extension: parsed.data.extension,
      mimeAllowlist: parsed.data.mimeAllowlist,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
    })

    return NextResponse.json({ success: true, data: fileType })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '파일 유형 수정에 실패했습니다.',
      },
    }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { denied } = await requireAdminUser()

  if (denied) {
    return denied
  }

  try {
    const { id } = await params
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    await deleteMarketFileType(id, workspaceSubject)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '파일 유형 삭제에 실패했습니다.',
      },
    }, { status: 500 })
  }
}
