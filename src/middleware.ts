import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    // 확장자로 끝나는 경로도 거친다. 예전에는 .png 등으로 끝나면 건너뛰었는데, 그 틈으로
    // (1) 꺼 둔 기능의 차단을 피할 수 있었고 (2) 위조한 x-auth-user-id 헤더가 지워지지 않은 채 페이지에 닿았다.
    // 실제 정적 파일 요청은 updateSession이 세션 작업 없이 바로 통과시킨다.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
