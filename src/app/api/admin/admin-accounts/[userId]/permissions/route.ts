import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AdminAccountError, replaceAdminPermissionGrants } from '@/lib/admin-accounts-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

// 권한 부여·회수는 대표 관리자만 한다(계획 U3-4).
async function requireOwner() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
}

// 한도 값의 모양·의존·알 수 없는 권한은 서버가 validateAdminPermissionGrants로 다시 검증한다.
const PutSchema = z.object({
  grants: z.array(z.object({
    permission: z.string().trim().min(1),
    limits: z.record(z.string(), z.unknown()).optional(),
  })).max(50),
})

// 대상 일반 관리자의 권한을 통째로 바꾼다. 작업 기록은 DB 함수가 같은 트랜잭션으로 남긴다.
// 바뀐 권한은 그 계정의 다음 요청부터 적용된다(가드가 요청마다 DB를 읽는다).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireOwner()
  if ('error' in guard) return guard.error

  const { userId } = await params
  const body = await request.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '입력이 올바르지 않습니다.' }, { status: 400 })
  }

  try {
    const data = await replaceAdminPermissionGrants({
      actorId: guard.userId,
      userId,
      grants: parsed.data.grants,
    })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    if (error instanceof AdminAccountError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: '권한을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
