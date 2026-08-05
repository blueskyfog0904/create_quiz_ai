import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  MARKET_HOME_SETTING_KEY,
  validateMarketHomeConfig,
  type MarketHomeConfig,
} from '@/lib/market-home'
import { getMarketHomeAdminOptions } from '@/lib/market-home-server'
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

class MarketHomeAdminValidationError extends Error {}

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

function validateAllowlist(
  config: MarketHomeConfig,
  categoryIds: Set<string>,
  sourceTypes: Set<string>
) {
  const invalidCategory = config.categories.menuEntryIds.find((id) => !categoryIds.has(id))
  if (invalidCategory) {
    throw new MarketHomeAdminValidationError('선택한 카테고리가 현재 과목의 활성 메뉴에 없습니다.')
  }

  const invalidSourceType = config.sourceExplorer.sourceTypes.find(
    (typeName) => !sourceTypes.has(typeName)
  )
  if (invalidSourceType) {
    throw new MarketHomeAdminValidationError('선택한 출처 유형이 현재 과목의 출처 설정에 없습니다.')
  }
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
    const options = await getMarketHomeAdminOptions(workspaceSubject)
    validateAllowlist(
      config,
      new Set(options.categories.map((category) => category.id)),
      new Set(options.sourceTypes.map((source) => source.typeName))
    )

    await upsertWorkspaceSetting({
      workspaceSubject,
      settingKey: MARKET_HOME_SETTING_KEY,
      value: config as unknown as Json,
      description: '문제마켓 메인 화면 설정',
      updatedBy: user.id,
    })

    revalidatePath('/admin/market-main-settings')
    revalidatePath('/preview/solvook-concept')
    return NextResponse.json({ success: true, data: { config } })
  } catch (error) {
    if (error instanceof MarketHomeAdminValidationError) {
      return errorResponse('INVALID_INPUT', error.message, 400)
    }
    return errorResponse('INTERNAL_ERROR', '문제마켓 메인 설정 저장에 실패했습니다.', 500)
  }
}
