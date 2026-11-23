// 자료 환불 공용 규칙(8번 묶음). DB 함수와 같은 식을 쓴다 — 표 테스트로 TS = SQL 을 맞춘다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// 마감 = 구매일(한국 시간) 다음 날부터 refundDays 일째 되는 날 24:00
//      = (구매일 KST + refundDays + 1) 00:00 KST. DB market_refund_deadline 과 같다. 조건은 '기준 시각 < 마감'.
export function marketRefundDeadline(purchasedAt: string | Date, refundDays: number): Date {
  const purchased = new Date(purchasedAt)
  const kst = new Date(purchased.getTime() + KST_OFFSET_MS)
  const kstMidnightUtcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate())
  return new Date(kstMidnightUtcMs + (refundDays + 1) * DAY_MS - KST_OFFSET_MS)
}

export function isWithinMarketRefundPeriod(purchasedAt: string | Date, refundDays: number, judgeAt: Date = new Date()) {
  return judgeAt.getTime() < marketRefundDeadline(purchasedAt, refundDays).getTime()
}

// 화면 표시용 마지막 날(한국 날짜) — 'N월 N일(한국 시간)까지'
export function marketRefundLastDayLabel(purchasedAt: string | Date, refundDays: number) {
  return formatMarketRefundLastDay(marketRefundDeadline(purchasedAt, refundDays))
}

// 마감 시각(다음 날 00:00 KST) → 마지막 날 표시
export function formatMarketRefundLastDay(deadline: string | Date) {
  const lastDay = new Date(new Date(deadline).getTime() - 1 + KST_OFFSET_MS)
  return `${lastDay.getUTCMonth() + 1}월 ${lastDay.getUTCDate()}일(한국 시간)까지`
}

// 환불 심사 중인 주문의 차단 범위. 전체 요청·대상 없는 예외 요청이면 그 주문 권한 전부,
// 부분 요청·대상을 지정한 예외 요청이면 대상 자료(같은 분류의 교체본 포함)만.
export interface PendingMarketRefundScope {
  orderId: string
  kind: 'full' | 'partial' | 'exception'
  subproductIds: string[]
  categorySlugs: string[]
}

export function isPendingRefundBlockingFile(
  scope: PendingMarketRefundScope | undefined,
  file: { subproductId: string; categorySlug: string | null }
) {
  if (!scope) return false
  if (scope.kind !== 'partial') return true
  if (scope.subproductIds.includes(file.subproductId)) return true
  return file.categorySlug !== null && scope.categorySlugs.includes(file.categorySlug)
}

// 심사 중인 환불 요청 행 → 주문별 차단 범위. 다운로드 route·자료 보관함·상품 상세·관리자 진단이 같이 쓴다.
// 대상 자료의 분류를 못 찾으면(삭제된 서브상품 등) 교체본 차단을 판단할 수 없으므로 그 주문 전체를 막는다(fail closed).
export function buildPendingMarketRefundScopes(
  requests: Array<{ order_id: string | null; refund_kind?: string | null; refund_subproduct_ids?: string[] | null }>,
  slugOf: (subproductId: string) => string | null | undefined
) {
  const scopes = new Map<string, PendingMarketRefundScope>()
  for (const request of requests) {
    if (!request.order_id) continue
    const subproductIds = request.refund_subproduct_ids ?? []
    const slugs = subproductIds.map((id) => slugOf(id) ?? null)
    // 패키지의 예외 요청(대상 자료 지정)도 부분 요청처럼 대상만 막는다. 대상 없는 예외(서브상품 주문)는 주문 전체.
    const targeted = subproductIds.length > 0 && slugs.every(Boolean)
    const kind = (request.refund_kind === 'partial' || request.refund_kind === 'exception') && targeted ? 'partial'
      : request.refund_kind === 'exception' ? 'exception' : 'full'
    scopes.set(request.order_id, {
      orderId: request.order_id,
      kind,
      subproductIds,
      categorySlugs: slugs.filter((slug): slug is string => Boolean(slug)),
    })
  }
  return scopes
}

// 환불 승인 알림 문구(승인·대표 정산·예외 환불 공용). 다시 지급한 몫과 돌려주지 못한 몫을 따로 알린다(정책 3-2 ⑥⑦).
export function buildMarketRefundApprovedMessage(request: {
  requested_refund_credits?: number | null
  approved_refund_credits?: number | null
  allocated_items?: unknown
}) {
  if (typeof request.approved_refund_credits !== 'number') return '크레딧 복구 내역은 크레딧 관리에서 확인해 주세요.'
  const items = Array.isArray(request.allocated_items) ? (request.allocated_items as Array<{ reissued?: number }>) : []
  const reissued = items.reduce((sum, item) => sum + (Number(item.reissued) || 0), 0)
  const missing = typeof request.requested_refund_credits === 'number'
    ? Math.max(request.requested_refund_credits - request.approved_refund_credits, 0)
    : 0
  return [
    `${request.approved_refund_credits.toLocaleString()} 크레딧이 돌아왔습니다.`,
    reissued > 0 ? `그중 ${reissued.toLocaleString()} 크레딧은 새 유효기간으로 다시 지급되었습니다(만료일은 크레딧 관리에서 확인해 주세요).` : '',
    missing > 0 ? `나머지 ${missing.toLocaleString()} 크레딧은 결제에 쓴 크레딧의 사정(충전 환불 이력 등)으로 돌려드리지 못했습니다. 자세한 내용은 고객센터로 문의해 주세요.` : '',
  ].filter(Boolean).join(' ')
}
