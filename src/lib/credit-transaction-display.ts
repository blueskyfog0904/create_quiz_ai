import type { CreditSourceCategory } from '@/lib/credit-source-display'

interface CreditTransactionSourceInfo {
  source_category: CreditSourceCategory
}

export interface CreditTransactionDisplayInput {
  type: string
  amount: number
  description: string
  source?: CreditTransactionSourceInfo | null
}

function getPurchaseLabel(sourceCategory?: CreditSourceCategory | null): string {
  switch (sourceCategory) {
    case 'admin_grant':
    case 'bonus':
      return '지급'
    case 'system_refund':
      return '환불'
    case 'plan_purchase':
    default:
      return '충전'
  }
}

function formatPurchaseDescription(
  description: string,
  amount: number,
  sourceCategory?: CreditSourceCategory | null
): string {
  const creditsText = `크레딧 ${amount.toLocaleString()}개`

  switch (sourceCategory) {
    case 'admin_grant':
    case 'bonus':
      return `${creditsText} 지급`
    case 'system_refund':
      return `${creditsText} 환불`
    case 'plan_purchase':
    default:
      return `${creditsText} 충전`
  }
}

function formatConsumeDescription(description: string): string {
  if (description.includes('문제마켓')) {
    return description
  }

  return description.replace(/구매$/, '사용')
}

export function getCreditTransactionTypeLabel(transaction: CreditTransactionDisplayInput): string {
  if (transaction.type === 'purchase') {
    return getPurchaseLabel(transaction.source?.source_category)
  }

  if (transaction.type === 'admin_grant') {
    return '지급'
  }

  if (transaction.type === 'consume') {
    return '사용'
  }

  if (transaction.type === 'refund') {
    // 관리자 지급분에서 빠진 음수 기록은 관리자 회수(20261118150000).
    const category = transaction.source?.source_category
    if (transaction.amount < 0 && (category === 'admin_grant' || category === 'bonus' || category === 'system_refund')) {
      return '회수'
    }
    return '환불'
  }

  return transaction.type
}

export function getCreditTransactionDescription(transaction: CreditTransactionDisplayInput): string {
  if (transaction.type === 'purchase') {
    return formatPurchaseDescription(
      transaction.description,
      transaction.amount,
      transaction.source?.source_category
    )
  }

  if (transaction.type === 'consume') {
    return formatConsumeDescription(transaction.description)
  }

  if (transaction.type === 'admin_grant') {
    return `크레딧 ${transaction.amount.toLocaleString()}개 지급`
  }

  return transaction.description
}
