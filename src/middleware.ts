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
    // 닫아 둔 옛 기능의 경로도 같은 이유로 확장자와 무관하게 거친다(src/lib/site-features.ts).
    '/:subject(korean|english)/:path*',
    '/legacy/:path*',
    '/generate/:path*',
    '/bank/:path*',
    '/exam-papers/:path*',
    '/passages/:path*',
    '/library/:path*',
    // '/preview'는 넣지 않는다: public/preview 아래 정적 파일(확장자로 끝남)까지 닫히지 않게 한다.
    '/api/questions/:path*',
    '/api/generate/:path*',
    '/api/question-bank/:path*',
    '/api/exam-papers/:path*',
  ],
}
