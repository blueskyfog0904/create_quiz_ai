// 화면(클라이언트)에서도 쓰므로 서버 전용 코드와 분리해 둔다.

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
    return transaction.amount >= 0
      ? { label: '사용 취소', tone: 'blue' as const }
      : { label: '환불 회수', tone: 'red' as const }
  }
  return { label: transaction.type, tone: 'gray' as const }
}
