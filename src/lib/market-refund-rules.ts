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

// 10번: 탈퇴(익명화)한 회원에게는 크레딧으로 환불할 수 없다(DB 트리거가 MEMBER_WITHDRAWN 으로 거절). 대표가 현금으로 정산하고 기록을 남긴다.
export const MARKET_REFUND_MEMBER_WITHDRAWN_MESSAGE =
  '탈퇴한 회원이라 크레딧으로 환불할 수 없습니다. 대표가 원래 결제수단이나 계좌로 정산한 뒤 주문 상세의 \'탈퇴 회원 — 현금 정산 기록\'을 남겨 주세요.'

export function isMarketRefundMemberWithdrawnError(error: unknown): boolean {
  return error instanceof Error && error.message.trim() === 'MEMBER_WITHDRAWN'
}
