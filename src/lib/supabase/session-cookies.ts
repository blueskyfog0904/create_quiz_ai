import type { CookieOptions } from '@supabase/ssr'

// 로그인 세션을 '세션 쿠키'(브라우저 완전 종료 시 삭제)로 저장하기 위해
// 만료 관련 속성을 제거한다. 단 maxAge: 0은 쿠키 삭제(로그아웃) 신호이므로 보존한다.
// (@supabase/ssr은 cookieOptions로 maxAge를 넘겨도 기본 400일로 강제 덮어쓰므로
//  우리가 소유한 setAll 구현에서 제거하는 방식만이 유효하다)
export function toSessionCookieOptions(options?: CookieOptions): CookieOptions {
  const { maxAge, expires, ...rest } = options ?? {}
  void expires
  if (maxAge === 0) {
    return { ...rest, maxAge: 0 }
  }
  return rest
}
