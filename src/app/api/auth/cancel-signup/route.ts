import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { isTrustedFormPostOrigin } from '@/lib/password-reset'
import { clearAuthCookies, readFormPostOriginInput } from '@/lib/auth-cookie-clear'

// 카카오 가입 확인 단계의 "가입 취소": 가입을 마치지 않았고 결제 기록이 없는 카카오 계정만 지운다(카카오에서 받은 정보 삭제).
// /api 아래라 미들웨어의 카카오 가입 단계 분기를 거치지 않는다.
export async function POST(request: NextRequest) {
  if (!isTrustedFormPostOrigin(readFormPostOriginInput(request))) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const requestUserId = await getRequestAuthUserId()
  if (!user || !requestUserId || requestUserId !== user.id) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const admin = createAdminClient()
  const db = admin as unknown as SupabaseClient
  const { data: allowed, error } = await db.rpc('cancel_incomplete_kakao_signup', { p_user_id: user.id })
  if (error) {
    console.error('[CancelSignup] check failed', { code: error.code })
    return NextResponse.json({ error: '가입을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  if (allowed !== true) {
    return NextResponse.json({ error: '가입을 마쳤거나 결제 기록이 있는 계정은 여기서 취소할 수 없습니다. 고객지원으로 문의해 주세요.' }, { status: 409 })
  }

  // deleteUser 직전 한 번 더 확인한다(그 사이 가입 완료·결제가 생겼으면 지우지 않는다).
  const { data: recheck, error: recheckError } = await db.rpc('cancel_incomplete_kakao_signup', { p_user_id: user.id })
  if (recheckError || recheck !== true) {
    return NextResponse.json({ error: '가입을 취소하지 못했습니다. 고객지원으로 문의해 주세요.' }, { status: 409 })
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('[CancelSignup] deleteUser failed', { status: deleteError.status })
    return NextResponse.json({ error: '가입을 취소하지 못했습니다. 고객지원으로 문의해 주세요.' }, { status: 409 })
  }

  return clearAuthCookies(request, NextResponse.json({ success: true }))
}
