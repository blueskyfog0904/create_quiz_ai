import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ADMIN_PASSWORD_MIN_LENGTH } from '@/lib/admin-accounts-shared'
import { AdminAccountError, changeOwnAdminPassword } from '@/lib/admin-accounts-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const PostSchema = z.object({
  currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요.'),
  newPassword: z.string()
    .min(ADMIN_PASSWORD_MIN_LENGTH, `비밀번호는 ${ADMIN_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`)
    // 인증 서버가 비밀번호를 72바이트까지만 쓴다(한글은 한 글자가 3바이트).
    .refine((value) => new TextEncoder().encode(value).length <= 72, '비밀번호는 72바이트(영문 72자, 한글 24자) 이하여야 합니다.'),
})

// 비밀번호를 바꾼 뒤 지금 세션만 남기고 다른 기기·브라우저의 로그인을 끊는다. 실패해도 변경은 성공으로 두고 로그만 남긴다.
async function signOutOtherSessions() {
  try {
    const { error } = await (await createClient()).auth.signOut({ scope: 'others' })
    if (error) {
      console.error('[my-password] 다른 세션 로그아웃 실패', { code: error.code, message: error.message })
      return false
    }
    return true
  } catch (error) {
    console.error('[my-password] 다른 세션 로그아웃 실패', { message: error instanceof Error ? error.message : String(error) })
    return false
  }
}

// 로그인한 관리자 본인의 비밀번호 변경(계획 4-1절 "staff 본인 비밀번호"). 관리자면 누구나, 본인 계정만 바꾼다.
export async function POST(request: NextRequest) {
  const guard = await requireAdminApiPermission('admin')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = PostSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const target = await changeOwnAdminPassword({
      userId: guard.access.userId,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    })
    const otherSessionsSignedOut = await signOutOtherSessions()
    await recordAdminAudit({
      actorId: guard.access.userId,
      action: 'admin_own_password_change',
      targetType: 'admin_account',
      targetId: guard.access.userId,
      details: { login_id: target.loginId, other_sessions_signed_out: otherSessionsSignedOut },
    })
    return NextResponse.json({ success: true, otherSessionsSignedOut })
  } catch (error) {
    if (error instanceof AdminAccountError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: '비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
