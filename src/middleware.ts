import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
    // 관리자 경로는 확장자로 끝나도(예: /admin/x/a.png) 반드시 거친다. 위 규칙의 확장자 제외로 기능 차단을 건너뛰지 못하게 한다.
    '/admin/:path*',
    '/api/admin/:path*',
    '/dashboard/admin/:path*',
  ],
}
