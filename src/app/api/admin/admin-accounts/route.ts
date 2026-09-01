import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AdminAccountError,
  createAdminAccount,
  listAdminAccounts,
} from '@/lib/admin-accounts-server'
import { ADMIN_LOGIN_ID_PATTERN, normalizeAdminLoginId } from '@/lib/admin-accounts-shared'
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

export async function GET() {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  try {
    const accounts = await listAdminAccounts()
    return NextResponse.json({ success: true, data: accounts, selfUserId: guard.user.id })
  } catch (error) {
    return toErrorResponse(error, '관리자 목록을 불러오지 못했습니다.')
  }
}

const CreateSchema = z.object({
  login_id: z.string()
    .transform((value) => normalizeAdminLoginId(value))
    .refine((value) => ADMIN_LOGIN_ID_PATTERN.test(value), '아이디는 영문 소문자·숫자·-·_ 3~30자여야 합니다.'),
  name: z.string().trim().min(1, '이름을 입력하세요.').max(60),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
})

export async function POST(request: NextRequest) {
  const guard = await requireAdminUser()
  if ('error' in guard) return guard.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const account = await createAdminAccount({
      loginId: parsed.data.login_id,
      name: parsed.data.name,
      password: parsed.data.password,
    })
    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    return toErrorResponse(error, '관리자 계정을 생성하지 못했습니다.')
  }
}
