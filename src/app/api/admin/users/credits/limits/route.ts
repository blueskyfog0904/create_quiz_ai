import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { ADMIN_PERMISSION_LIMIT_MAX } from '@/lib/admin-permissions'
import { AdminCreditGrantLimitsError, setAdminCreditGrantLimits } from '@/lib/admin-credit-grant-limits-server'

export const dynamic = 'force-dynamic'

const PutSchema = z.object({
  perGrant: z.number().int().min(1).max(ADMIN_PERMISSION_LIMIT_MAX),
  perDay: z.number().int().min(1).max(ADMIN_PERMISSION_LIMIT_MAX),
}).refine((value) => value.perGrant <= value.perDay, { message: '1회 한도는 하루 한도보다 클 수 없습니다.' })

// 직원 크레딧 지급의 기본 한도를 바꾼다(대표, 또는 credits.limits.manage를 받은 관리자).
// 작업 기록(credit_grant_limits_update)은 DB 함수가 같은 트랜잭션으로 남긴다.
export async function PUT(request: Request) {
  const guard = await requireAdminApiPermission('credits.limits.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '한도는 1 이상의 정수로 입력해 주세요.' }, { status: 400 })
  }

  try {
    const limits = await setAdminCreditGrantLimits({ actorId: guard.access.userId, ...parsed.data })
    return NextResponse.json({ success: true, limits })
  } catch (error) {
    if (error instanceof AdminCreditGrantLimitsError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[admin-credit-grant-limits] 저장 실패', error)
    return NextResponse.json({ error: '기본 한도를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
