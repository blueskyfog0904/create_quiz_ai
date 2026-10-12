import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, isAdmin: false }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return { user, isAdmin: Boolean(profile?.is_admin) }
}

export async function POST(request: Request) {
  const { user, isAdmin } = await requireAdminUser()
  if (!user) return errorResponse('UNAUTHORIZED', '로그인이 필요합니다.', 401)
  if (!isAdmin) return errorResponse('FORBIDDEN', '관리자 권한이 필요합니다.', 403)

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
