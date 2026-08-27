import { headers } from 'next/headers'

// 미들웨어(updateSession)가 supabase.auth.getUser() 검증을 마친 뒤 설정하는 헤더.
// 외부에서 들어온 동명 헤더는 미들웨어가 항상 삭제 후 재설정하므로 위조될 수 없다.
export const AUTH_USER_ID_HEADER = 'x-auth-user-id'

export async function getRequestAuthUserId(): Promise<string | null> {
  const headerStore = await headers()
  return headerStore.get(AUTH_USER_ID_HEADER)
}
