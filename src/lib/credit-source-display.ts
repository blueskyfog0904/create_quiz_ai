interface CreditSourcePlanInfo {
  name: string
  price: number
}

export interface CreditSourceDisplayInput {
  status: 'active' | 'pending_refund' | 'refunded'
  plan: CreditSourcePlanInfo | null
  paymentMethod?: string | null
}

function getNonPlanSourceLabel(paymentMethod?: string | null): string {
  switch (paymentMethod) {
    case 'admin_grant':
      return '관리자 지급'
    case 'system_refund':
      return '환불'
    default:
      return '기타 지급'
  }
}

export function getCreditSourceCategoryLabel(source: CreditSourceDisplayInput): string {
  const baseLabel = source.plan?.name ?? getNonPlanSourceLabel(source.paymentMethod)

  if (source.plan?.name && source.status === 'refunded') {
    return `${source.plan.name} / 환불`
  }

  return baseLabel
}
