import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { checkAdminLimit } from '@/lib/admin-permissions'
import { alertAdminAuditFailure, recordAdminAudit } from '@/lib/admin-audit-log-server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CreditService } from '@/lib/credits'
import { resolveAdminGrantSourceCategory } from '@/lib/credit-source-display'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'

const GrantCreditSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive('Amount must be positive').max(10000, '한 번에 최대 10,000 크레딧까지만 지급할 수 있습니다.'),
  description: z.string().min(1, 'Description is required'),
  category: z.enum(['compensation', 'event', 'refund', 'other']).default('other'),
  // 재전송·더블클릭에도 한 번만 지급되도록 화면이 만든 키
  idempotencyKey: z.string().uuid()
})

export async function POST(request: Request) {
  const supabase = await createClient()

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

    // 계정의 1회 지급 한도(대표는 한도 없음). 하루 누적 한도(per_day)는 지급 함수(DB)가 같은 트랜잭션에서
    // 합산해야 해서 여기서 검사하지 않는다 — 지급 함수 개정(U3-6) 전에는 하루 한도가 적용되지 않는다.
    if (!checkAdminLimit(guard.access, 'credits.grant', 'per_grant', amount)) {
      return NextResponse.json({
        error: '이 계정의 1회 지급 한도를 넘는 금액입니다. 대표 관리자에게 요청해 주세요.',
        code: 'ADMIN_LIMIT_EXCEEDED'
      }, { status: 403 })
    }

    // 2. Grant Credits
    const categoryLabel = {
      compensation: '보상',
      event: '이벤트',
      refund: '환불',
      other: '기타'
    }[category] || '기타'

    const sourceCategory = resolveAdminGrantSourceCategory(category)

    // 2. Grant Credits via dedicated admin path
    const result = await CreditService.grantCreditsAsAdmin(
      userId,
      amount,
      sourceCategory,
      'admin_grant',
      `admin_grant:${idempotencyKey}`,
    )

    // 지급이 끝난 뒤 작업 기록을 남긴다(실패해도 응답은 그대로). 같은 키의 재요청은 새 지급이 아니므로 남기지 않는다.
    // 지급 함수 개정(U3-6, DB-6') 뒤에는 함수 안에서 같은 트랜잭션으로 적고 이 호출은 뺀다.
    let audited = true
    if (!result.alreadyGranted) {
      audited = await recordAdminAudit({
        actorId: guard.access.userId,
        action: 'credit_grant',
        targetType: 'member',
        targetId: userId,
        targetUserId: userId,
        amount,
        reason: description,
        details: { category, source_category: sourceCategory, operation_key: `admin_grant:${idempotencyKey}`, new_balance: result.newBalance },
      })
      // 돈이 움직인 일의 기록이 빠지면 대표에게 알린다(지급 결과는 그대로).
      if (!audited) {
        await alertAdminAuditFailure({ action: 'credit_grant', refTable: 'profiles', refId: userId, link: `/admin/users/${userId}`, dedupeId: idempotencyKey })
      }
    }

    // 3. Send Notification (같은 키로 이미 지급된 재요청이면 다시 보내지 않는다)
    if (!result.alreadyGranted) {
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'info',
        title: '크레딧이 지급되었습니다',
        message: `${categoryLabel} 사유로 ${amount.toLocaleString()} 크레딧이 지급되었습니다. (내용: ${description})`,
        link: '/mypage/credits',
        is_read: false
      })
    }

    const snapshot = await getCreditBalanceSnapshot(userId)

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
      ...buildCreditBalanceResponseFields(snapshot),
      ...(audited ? {} : { auditWarning: '지급은 완료됐지만 작업 기록을 남기지 못했습니다. 대표 관리자에게 알렸습니다.' }),
    })

  } catch (error: unknown) {
    console.error('Grant Credits Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    if (error instanceof Error && error.message === 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT') {
      return NextResponse.json({
        error: '이 창에서 보낸 이전 지급이 이미 처리되었습니다. 지급 내역을 먼저 확인하고, 추가 지급이 필요할 때만 창을 닫고 다시 열어 지급하세요.',
        code: 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT'
      }, { status: 409 })
    }

    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to grant credits'
    }, { status: 500 })
  }
}
