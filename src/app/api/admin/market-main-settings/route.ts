import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import {
  MARKET_HOME_SETTING_KEY,
  validateMarketHomeConfig,
  type MarketHomeConfig,
} from '@/lib/market-home'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import { upsertWorkspaceSetting } from '@/lib/workspace-settings'
import type { Json } from '@/types/supabase'

export const dynamic = 'force-dynamic'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({
    success: false,
    error: { code, message },
  }, { status })
}

// 홈 화면 광고·진열 권한(storefront.edit)을 공용 가드로 확인한다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'storefront.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

export async function POST(request: Request) {
  const { user, denied } = await requireAdminUser()
  if (denied) return denied

  const subject = new URL(request.url).searchParams.get('subject')
  if (!isWorkspaceSubject(subject)) {
    return errorResponse('INVALID_INPUT', '과목은 english 또는 korean이어야 합니다.', 400)
  }
  const workspaceSubject = subject

  let config: MarketHomeConfig
  try {
    config = validateMarketHomeConfig(await request.json())
  } catch (error) {
    return errorResponse(
      'INVALID_INPUT',
      error instanceof Error ? error.message : '입력값을 확인해 주세요.',
      400
    )
  }

  try {
    await upsertWorkspaceSetting({
      workspaceSubject,
      settingKey: MARKET_HOME_SETTING_KEY,
      value: config as unknown as Json,
      description: '문제마켓 메인 화면 설정',
      updatedBy: user.id,
    })

    revalidatePath('/admin/market-main-settings')
    revalidatePath('/preview/solvook-concept')
    revalidatePath('/')
    return NextResponse.json({ success: true, data: { config } })
  } catch {
    return errorResponse('INTERNAL_ERROR', '문제마켓 메인 설정 저장에 실패했습니다.', 500)
  }
}
