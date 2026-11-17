import { NextRequest, NextResponse } from 'next/server'
import { AdminAccountError, revokeAdminAccount } from '@/lib/admin-accounts-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

// 권한 해제는 대표 관리자만 한다(작업계획서 W4-6).
async function requireOwner() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

// 일반 관리자의 관리자 자격을 통째로 해제한다(관리자 목록에서 빠지고 관리자 화면에 들어올 수 없다).
// 계정과 그 계정이 남긴 이력은 지우지 않는다. 다시 주는 화면은 없다(새 아이디 발급, 결정 Q-12).
// 작업 기록은 DB 함수가 같은 트랜잭션으로 남긴다.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireOwner()
  if ('error' in guard) return guard.error

  const { userId } = await params

  try {
    await revokeAdminAccount({ actorId: guard.userId, userId })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AdminAccountError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: '권한을 해제하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
