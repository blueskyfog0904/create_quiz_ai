import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isTrustedFormPostOrigin } from '@/lib/password-reset'
import { clearAuthCookies, readFormPostOriginInput } from '@/lib/auth-cookie-clear'

// 동의 화면의 "지금은 동의하지 않고 로그아웃": 이 기기만 로그아웃한다. 서버 액션은 응답 뒤 화면을 다시 그려 이동이 꼬일 수 있어 route 로 둔다.
// signOut 결과와 상관없이 로그인 쿠키를 지운다(세션이 서버에서 폐기되면 남은 쿠키로도 다시 로그인되지 않는다).
export async function POST(request: NextRequest) {
  if (!isTrustedFormPostOrigin(readFormPostOriginInput(request))) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    console.warn('[ConsentLogout] signOut failed', { status: error.status })
  }
  return clearAuthCookies(request, NextResponse.json({ success: true }))
}
