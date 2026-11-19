import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  AdminAccountError,
  createAdminAccount,
  listAdminAccounts,
  readAdminPermissionPresets,
} from '@/lib/admin-accounts-server'
import { ADMIN_LOGIN_ID_PATTERN, ADMIN_PASSWORD_MIN_LENGTH, normalizeAdminLoginId } from '@/lib/admin-accounts-shared'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'

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

export async function GET() {
  const guard = await requireOwner()
  if ('error' in guard) return guard.error

  try {
    const [accounts, presets] = await Promise.all([listAdminAccounts(), readAdminPermissionPresets()])
    return NextResponse.json({ success: true, data: accounts, selfUserId: guard.userId, presets })
  } catch (error) {
    return toErrorResponse(error, '관리자 목록을 불러오지 못했습니다.')
  }
}

const CreateSchema = z.object({
  login_id: z.string()
    .transform((value) => normalizeAdminLoginId(value))
    .refine((value) => ADMIN_LOGIN_ID_PATTERN.test(value), '아이디는 영문 소문자·숫자·-·_ 3~30자여야 합니다.'),
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH, `비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`),
})

export async function POST(request: NextRequest) {
  const guard = await requireOwner()
  if ('error' in guard) return guard.error

  const body = await request.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const account = await createAdminAccount({
      loginId: parsed.data.login_id,
      password: parsed.data.password,
    })
    await recordAdminAudit({
      actorId: guard.userId,
      action: 'admin_account_create',
      targetType: 'admin_account',
      targetId: account.userId,
      details: { login_id: account.loginId, role: account.role },
    })
    return NextResponse.json({ success: true, data: account })
  } catch (error) {
    return toErrorResponse(error, '관리자 계정을 생성하지 못했습니다.')
  }
}
