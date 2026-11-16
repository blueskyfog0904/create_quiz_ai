import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  buildAdminAccess,
  hasAdminPermission,
  type AdminAccess,
  type AdminPermissionRequirement,
} from '@/lib/admin-permissions'

// 로그인한 사용자의 관리자 역할·권한·한도를 요청당 한 번 읽는다(계획 4-1절).
// 조회 오류는 "권한 없음"과 구분해 예외로 올린다: 권한 0개로 조용히 떨어뜨리면 장애가 권한 문제로 보인다.
const readAdminSession = cache(async (): Promise<{ userId: string | null; access: AdminAccess | null }> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, access: null }

  // 권한 표의 조회 정책은 "본인 행 또는 대표는 전체"다. 대표도 본인 행만 읽도록 user_id를 건다.
  const [profile, grants] = await Promise.all([
    supabase.from('profiles').select('is_admin, admin_role').eq('id', user.id).maybeSingle(),
    supabase.from('admin_permission_grants').select('permission, limits').eq('user_id', user.id),
  ])
  if (profile.error || grants.error) {
    console.error('[AdminAccess] lookup failed', {
      profileErrorCode: profile.error?.code,
      grantsErrorCode: grants.error?.code,
    })
    throw new Error('ADMIN_ACCESS_LOOKUP_FAILED')
  }

  return { userId: user.id, access: buildAdminAccess(user.id, profile.data, grants.data) }
})

// 관리자가 아니거나 로그인하지 않았으면 null. 화면에서 권한별로 구역·버튼을 가릴 때도 쓴다.
export async function getAdminAccess(): Promise<AdminAccess | null> {
  return (await readAdminSession()).access
}

// 페이지용. 조회 오류는 그대로 던져 오류 화면이 뜨게 한다.
export async function requireAdminPagePermission(requirement: AdminPermissionRequirement): Promise<AdminAccess> {
  const { userId, access } = await readAdminSession()
  if (!userId) redirect('/admin/login')
  if (!access) redirect('/admin/login?error=forbidden')
  if (!hasAdminPermission(access, requirement)) redirect('/admin/forbidden')
  return access
}

// route용. 'error' in 결과이면 NextResponse.json({ error }, { status })로 돌려준다.
export async function requireAdminApiPermission(requirement: AdminPermissionRequirement) {
  let session: Awaited<ReturnType<typeof readAdminSession>>
  try {
    session = await readAdminSession()
  } catch {
    return { error: '권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', status: 500 } as const
  }
  if (!session.userId) return { error: 'Unauthorized', status: 401 } as const
  if (!session.access) return { error: 'Forbidden: Admin only', status: 403 } as const
  if (!hasAdminPermission(session.access, requirement)) {
    return { error: '이 작업을 할 권한이 없습니다.', status: 403 } as const
  }
  return { access: session.access } as const
}

// 서버 액션용 예외. 액션은 이것을 잡아 { success: false, error: error.message }로 돌려준다.
export class AdminPermissionError extends Error {
  constructor(
    readonly reason: 'unauthenticated' | 'forbidden' | 'unavailable',
    message: string
  ) {
    super(message)
    this.name = 'AdminPermissionError'
  }
}

// 서버 액션용. redirect하지 않고 AdminPermissionError를 던진다.
export async function assertAdminActionPermission(requirement: AdminPermissionRequirement): Promise<AdminAccess> {
  let session: Awaited<ReturnType<typeof readAdminSession>>
  try {
    session = await readAdminSession()
  } catch {
    throw new AdminPermissionError('unavailable', '권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  if (!session.userId) throw new AdminPermissionError('unauthenticated', '로그인이 필요합니다.')
  if (!session.access || !hasAdminPermission(session.access, requirement)) {
    throw new AdminPermissionError('forbidden', '이 작업을 할 권한이 없습니다.')
  }
  return session.access
}
