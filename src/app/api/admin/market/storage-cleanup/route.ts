import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { retryMarketStorageCleanup } from '@/lib/market-storage-cleanup'

export const dynamic = 'force-dynamic'

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  return null
}

// 지우지 못한 파일을 다시 정리한다.
export async function POST() {
  const denied = await requireAdminUser()
  if (denied) return denied

  try {
    const result = await retryMarketStorageCleanup()
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: error instanceof Error ? error.message : '파일 정리에 실패했습니다.' },
    }, { status: 500 })
  }
}
