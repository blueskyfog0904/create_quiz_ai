import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AdminAccountError,
  deleteAdminAccount,
  updateAdminAccount,
} from '@/lib/admin-accounts-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

// 관리자 계정 관리는 대표 관리자만 한다.
async function requireOwner() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

function toErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof AdminAccountError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallbackMessage },
    { status: 500 }
  )
}

const PatchSchema = z.object({
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireOwner()
  if ('error' in guard) return guard.error

  const { userId } = await params
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    await updateAdminAccount({
      userId,
      password: parsed.data.password,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error, '관리자 계정을 수정하지 못했습니다.')
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireOwner()
  if ('error' in guard) return guard.error

  const { userId } = await params

  try {
    await deleteAdminAccount({ userId, actorId: guard.userId })
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error, '관리자 계정을 삭제하지 못했습니다.')
  }
}
