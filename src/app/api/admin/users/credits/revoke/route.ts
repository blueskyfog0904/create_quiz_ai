import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/bypass'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { ADMIN_PERMISSION_LIMIT_MAX } from '@/lib/admin-permissions'
import { CreditService } from '@/lib/credits'

// 잘못 지급한 크레딧 회수(계획 U3-7). 관리자 지급분의 지급 건 하나를 골라 그 건의 남은 수량 안에서만 회수한다.
// 회수·한도(직원의 1회 회수 한도)·작업 기록은 회수 함수(DB)가 한 트랜잭션으로 한다(20261118150000).
const RevokeSchema = z.object({
  sourceId: z.string().uuid(),
  amount: z.number().int().positive().max(ADMIN_PERMISSION_LIMIT_MAX),
  reason: z.string().trim().min(1, '회수 사유를 입력해 주세요.').max(500, '회수 사유는 500자 이내로 입력해 주세요.'),
  // 재전송·더블클릭에도 한 번만 회수되도록 화면이 만든 키
  idempotencyKey: z.string().uuid(),
})

const formatCredits = (value: number) => value.toLocaleString('ko-KR')

function revokeRejection(message: string): { status: number; error: string; code: string } | null {
  const perGrant = message.match(/^ADMIN_REVOKE_LIMIT_PER_GRANT limit=(\d+)/)
  if (perGrant) {
    return { status: 403, code: 'ADMIN_LIMIT_EXCEEDED', error: `이 계정의 1회 회수 한도(${formatCredits(Number(perGrant[1]))} 크레딧)를 넘습니다. 대표 관리자에게 요청해 주세요.` }
  }
  const exceeds = message.match(/^ADMIN_REVOKE_EXCEEDS_REMAINING remaining=(\d+)/)
  if (exceeds) {
    return { status: 409, code: 'ADMIN_REVOKE_EXCEEDS_REMAINING', error: `이 지급 건에 남은 크레딧(${formatCredits(Number(exceeds[1]))})보다 많이 회수할 수 없습니다. 이미 사용한 크레딧은 회수되지 않습니다.` }
  }
  switch (message) {
    case 'ADMIN_REVOKE_REPLAY_MISSING':
    case 'ADMIN_REVOKE_IDEMPOTENCY_CONFLICT':
      return { status: 409, code: 'ADMIN_REVOKE_IDEMPOTENCY_CONFLICT', error: '이 창에서 보낸 이전 회수가 이미 처리되었습니다. 크레딧 내역을 먼저 확인하고, 추가 회수가 필요할 때만 창을 닫고 다시 열어 주세요.' }
    case 'ADMIN_REVOKE_SELF_TARGET':
      return { status: 403, code: 'ADMIN_SELF_TARGET', error: '본인 계정의 크레딧은 회수할 수 없습니다. 다른 관리자에게 요청해 주세요.' }
    case 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED':
      return { status: 403, code: 'ADMIN_FORBIDDEN', error: '이 작업을 할 권한이 없습니다.' }
    case 'ADMIN_REVOKE_LIMIT_NOT_SET':
      return { status: 403, code: 'ADMIN_LIMIT_NOT_SET', error: '회수 한도가 설정되어 있지 않습니다. 대표 관리자에게 문의해 주세요.' }
    case 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT':
      return { status: 409, code: 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT', error: '관리자가 지급한 크레딧만 회수할 수 있습니다(결제로 충전한 크레딧은 회수 대상이 아닙니다).' }
    case 'ADMIN_REVOKE_SOURCE_NOT_ACTIVE':
      return { status: 409, code: 'ADMIN_REVOKE_SOURCE_NOT_ACTIVE', error: '만료되었거나 사용할 수 없는 지급 건이라 회수할 수 없습니다.' }
    case 'ADMIN_REVOKE_SOURCE_NOT_FOUND':
    case 'CREDIT_USER_NOT_FOUND':
      return { status: 404, code: 'ADMIN_REVOKE_SOURCE_NOT_FOUND', error: '회수할 지급 건을 찾을 수 없습니다. 새로고침해 주세요.' }
    case 'ADMIN_REVOKE_INPUT_INVALID':
      return { status: 400, code: 'ADMIN_REVOKE_INPUT_INVALID', error: '회수 내용이 올바르지 않습니다. 수량과 사유를 확인해 주세요.' }
    default:
      return null
  }
}

export async function POST(request: Request) {
  const guard = await requireAdminApiPermission('credits.revoke')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = RevokeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '회수 내용이 올바르지 않습니다.' }, { status: 400 })
  }
  const { sourceId, amount, reason, idempotencyKey } = parsed.data

  try {
    const result = await CreditService.revokeCreditsAsAdmin({
      actorId: guard.access.userId,
      sourceId,
      credits: amount,
      reason,
      operationKey: `admin_revoke:${idempotencyKey}`,
    })

    // 회원 알림(서버 키). 같은 키의 재요청이면 다시 보내지 않는다. 알림이 실패해도 회수는 이미 끝났으므로 성공으로 답하되 화면에 알린다.
    let notified = false
    if (!result.alreadyRevoked) {
      const { error: notifyError } = await createAdminClient().from('notifications').insert({
        user_id: result.userId,
        type: 'info',
        title: '크레딧이 회수되었습니다',
        message: `잘못 지급된 크레딧 ${amount.toLocaleString()}개가 회수되었습니다. (사유: ${reason})`,
        link: '/mypage/credits',
        is_read: false,
      })
      if (notifyError) console.error('[admin-credit-revoke] 회원 알림 실패', { message: notifyError.message })
      notified = !notifyError
    }

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
      sourceRemaining: result.sourceRemaining,
      alreadyRevoked: result.alreadyRevoked,
      notified,
    })
  } catch (error) {
    const rejection = error instanceof Error ? revokeRejection(error.message) : null
    if (rejection) {
      return NextResponse.json({ error: rejection.error, code: rejection.code }, { status: rejection.status })
    }
    console.error('[admin-credit-revoke] 회수 실패', error)
    return NextResponse.json({ error: '크레딧 회수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
