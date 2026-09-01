import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AdminAccountError,
  deleteAdminAccount,
  updateAdminAccount,
} from '@/lib/admin-accounts-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }
  return { user }
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
  name: z.string().trim().min(1, '이름을 입력하세요.').max(60).optional(),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').optional(),
}).refine((value) => value.name !== undefined || value.password !== undefined, '변경할 내용이 없습니다.')

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireAdminUser()
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
      name: parsed.data.name,
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
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const { userId } = await params

  try {
    await deleteAdminAccount({ userId, actorId: guard.user.id })
    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error, '관리자 계정을 삭제하지 못했습니다.')
  }
}
