import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { ADMIN_PERMISSION_LIMIT_MAX } from '@/lib/admin-permissions'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CreditService } from '@/lib/credits'
import { resolveAdminGrantSourceCategory } from '@/lib/credit-source-display'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'
import { notificationFailed, sendMemberNotification } from '@/lib/member-notifications-server'

// 지급 수량의 상한은 DB 정수 범위뿐이다. 직원의 1회·하루 한도는 지급 함수(DB)가 본다(대표는 한도 없음, 20261118120000).
const GrantCreditSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive('Amount must be positive').max(ADMIN_PERMISSION_LIMIT_MAX),
  description: z.string().trim().min(1, 'Description is required').max(500, '지급 사유는 500자 이내로 입력해 주세요.'),
  category: z.enum(['compensation', 'event', 'refund', 'other']).default('other'),
  // 재전송·더블클릭에도 한 번만 지급되도록 화면이 만든 키
  idempotencyKey: z.string().uuid()
})

const formatCredits = (value: number) => value.toLocaleString('ko-KR')

// 지급 함수가 거부한 이유(예외 문구)를 화면 안내로 바꾼다. 모르는 오류면 null.
function grantRejection(message: string): { status: number; error: string; code: string } | null {
  const perGrant = message.match(/^ADMIN_GRANT_LIMIT_PER_GRANT limit=(\d+)/)
  if (perGrant) {
    return {
      status: 403,
      code: 'ADMIN_LIMIT_EXCEEDED',
      error: `이 계정의 1회 지급 한도(${formatCredits(Number(perGrant[1]))} 크레딧)를 넘는 금액입니다. 대표 관리자에게 요청해 주세요.`,
    }
  }
  const perDay = message.match(/^ADMIN_GRANT_LIMIT_PER_DAY limit=(\d+) used=(\d+)/)
  if (perDay) {
    const limit = Number(perDay[1])
    const used = Number(perDay[2])
    return {
      status: 403,
      code: 'ADMIN_DAILY_LIMIT_EXCEEDED',
      error: `오늘 지급 한도(${formatCredits(limit)} 크레딧)를 넘습니다. 오늘 지급한 크레딧 ${formatCredits(used)}, 남은 한도 ${formatCredits(Math.max(limit - used, 0))}. 대표 관리자에게 요청해 주세요.`,
    }
  }
  switch (message) {
    case 'ADMIN_GRANT_REPLAY_MISSING':
    case 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT':
      return {
        status: 409,
        code: 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT',
        error: '이 창에서 보낸 이전 지급이 이미 처리되었습니다. 지급 내역을 먼저 확인하고, 추가 지급이 필요할 때만 창을 닫고 다시 열어 지급하세요.',
      }
    case 'ADMIN_GRANT_LIMIT_NOT_SET':
      return { status: 403, code: 'ADMIN_LIMIT_NOT_SET', error: '지급 한도가 설정되어 있지 않습니다. 대표 관리자에게 문의해 주세요.' }
    case 'ADMIN_GRANT_SELF_TARGET':
      return { status: 403, code: 'ADMIN_SELF_TARGET', error: '본인 계정에는 크레딧을 지급할 수 없습니다. 다른 관리자에게 요청해 주세요.' }
    case 'ADMIN_GRANT_ACTOR_NOT_ALLOWED':
      return { status: 403, code: 'ADMIN_FORBIDDEN', error: '이 작업을 할 권한이 없습니다.' }
    case 'CREDIT_USER_NOT_FOUND':
      return { status: 404, code: 'CREDIT_USER_NOT_FOUND', error: '지급할 회원을 찾을 수 없습니다.' }
    case 'ADMIN_GRANT_INPUT_INVALID':
      return { status: 400, code: 'ADMIN_GRANT_INPUT_INVALID', error: '지급 내용이 올바르지 않습니다. 금액과 사유를 확인해 주세요.' }
    default:
      return null
  }
}

export async function POST(request: Request) {
  // 1. Auth Check (크레딧 수동 지급 권한)
  const guard = await requireAdminApiPermission('credits.grant')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  try {
    const body = await request.json()
    const { userId, amount, description, category, idempotencyKey } = GrantCreditSchema.parse(body)

    // 본인 계정에는 지급하지 않는다(대표 포함 — 필요하면 다른 관리자가 지급한다).
    if (userId === guard.access.userId) {
      return NextResponse.json({
        error: '본인 계정에는 크레딧을 지급할 수 없습니다. 다른 관리자에게 요청해 주세요.',
        code: 'ADMIN_SELF_TARGET'
      }, { status: 403 })
    }

    // 2. Grant Credits
    const sourceCategory = resolveAdminGrantSourceCategory(category)

    // 지급·한도 확인·작업 기록(credit_grant)은 지급 함수가 한 트랜잭션으로 한다.
    // 같은 키의 재요청은 새 지급이 아니므로 한도를 보지 않고 기록도 다시 남지 않는다.
    const result = await CreditService.grantCreditsAsAdmin({
      actorId: guard.access.userId,
      userId,
      credits: amount,
      sourceCategory,
      reason: description,
      details: { category },
      operationKey: `admin_grant:${idempotencyKey}`,
    })

    // 3. Send Notification (같은 키로 이미 지급된 재요청이면 다시 보내지 않는다)
    // 16번: 회원 알림은 공용 함수가 서버 키로 넣는다(문구·분류 이름은 DB). 실패해도 지급은 그대로이고 화면에 알린다.
    let failed = false
    if (!result.alreadyGranted) {
      failed = notificationFailed(await sendMemberNotification({
        kind: 'creditGranted',
        userId,
        categoryKey: category,
        values: { '{수량}': amount, '{내용}': description },
      }))
    }

    const snapshot = await getCreditBalanceSnapshot(userId)

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
      ...buildCreditBalanceResponseFields(snapshot),
      notificationFailed: failed,
    })

  } catch (error: unknown) {
    console.error('Grant Credits Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    const rejection = error instanceof Error ? grantRejection(error.message) : null
    if (rejection) {
      return NextResponse.json({ error: rejection.error, code: rejection.code }, { status: rejection.status })
    }

    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to grant credits'
    }, { status: 500 })
  }
}
