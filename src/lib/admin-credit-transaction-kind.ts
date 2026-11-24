// 화면(클라이언트)에서도 쓰므로 서버 전용 코드와 분리해 둔다.

// 관리자가 지급한 크레딧의 원천 분류(회수 대상과 같다 — revoke_admin_credits).
export const ADMIN_GRANT_SOURCE_CATEGORIES: readonly string[] = ['admin_grant', 'bonus', 'system_refund']

// 거래 한 줄의 한글 유형 이름. 충전과 관리자 지급은 원천 분류로 구분한다.
export function getAdminCreditTransactionKind(transaction: { type: string; amount: number; source_category: string | null }) {
  if (transaction.type === 'purchase') {
    if (transaction.source_category === 'plan_purchase') return { label: '충전', tone: 'green' as const }
    if (transaction.source_category === 'admin_grant' || transaction.source_category === 'bonus') return { label: '관리자 지급', tone: 'amber' as const }
    if (transaction.source_category === 'system_refund') return { label: '환불 지급', tone: 'blue' as const }
    return { label: '충전·지급', tone: 'green' as const }
  }
  if (transaction.type === 'consume') return { label: '사용', tone: 'gray' as const }
  if (transaction.type === 'refund') {
    if (transaction.amount >= 0) return { label: '사용 취소', tone: 'blue' as const }
    // 관리자 지급분에서 빠진 음수 기록은 관리자 회수(20261118150000). 결제 환불 회수는 결제 충전분에서 빠진다.
    if (transaction.source_category && ADMIN_GRANT_SOURCE_CATEGORIES.includes(transaction.source_category)) {
      return { label: '관리자 회수', tone: 'red' as const }
    }
    return { label: '환불 회수', tone: 'red' as const }
  }
  // 회원 탈퇴 때 남은 크레딧 소멸(10번 묶음). 사용이 아니다.
  if (transaction.type === 'withdrawal_forfeit') return { label: '탈퇴 소멸', tone: 'gray' as const }
  return { label: transaction.type, tone: 'gray' as const }
}
