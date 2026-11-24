import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { attachWithdrawalForfeits, parseManualRefundRecoveryPreview } from '@/lib/manual-refund-recovery-preview'

export const dynamic = 'force-dynamic'

// 수동 환불 완료 화면의 원자료: 원래 충전 원천과 그 결제에서 비롯해 다시 지급한 크레딧(사슬 전체)의 원천별 값,
// 이 결제의 앞선 수동 완료 기록, 부분취소 금액, 처리 모드, 남은 환불 가능 금액, 쓸 수 있는 몫 합(회수 상한).
// 10번: 탈퇴 회원이면 원천별 탈퇴 소멸(withdrawal_forfeit) 합을 원장에서 더해 '사용'과 구분해 보여 준다.
export async function GET(request: Request) {
  const guard = await requireAdminApiPermission('refunds.payment')
  if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const requestId = z.string().uuid().safeParse(new URL(request.url).searchParams.get('requestId'))
  if (!requestId.success) {
    return NextResponse.json({ error: '환불 요청이 올바르지 않습니다.' }, { status: 400 })
  }

  const admin = createPaymentAdminClient()
  const { data, error } = await admin.rpc('get_manual_refund_recovery_preview', {
    p_request_id: requestId.data,
  })
  if (error) {
    console.error('[ManualRefundPreview] 미리보기 조회 실패', { code: error.code })
    return NextResponse.json({ error: '회수 원자료를 불러오지 못했습니다. 새로고침해 주세요.' }, { status: 503 })
  }
  const preview = parseManualRefundRecoveryPreview(data)
  if (!preview) {
    return NextResponse.json({ error: '환불 요청을 찾지 못했습니다. 새로고침해 주세요.' }, { status: 404 })
  }
  const sourceIds = preview.sources.map((source) => source.source_id)
  const forfeitedBySource = new Map<string, number>()
  if (sourceIds.length > 0) {
    const { data: forfeits, error: forfeitError } = await admin.from('credit_transactions')
      .select('source_id, amount').eq('type', 'withdrawal_forfeit').in('source_id', sourceIds)
    if (forfeitError) {
      console.error('[ManualRefundPreview] 탈퇴 소멸 조회 실패', { code: forfeitError.code })
      return NextResponse.json({ error: '회수 원자료를 불러오지 못했습니다. 새로고침해 주세요.' }, { status: 503 })
    }
    for (const row of forfeits ?? []) {
      if (row.source_id) forfeitedBySource.set(row.source_id, (forfeitedBySource.get(row.source_id) ?? 0) - row.amount)
    }
  }
  return NextResponse.json({ preview: attachWithdrawalForfeits(preview, forfeitedBySource) })
}
