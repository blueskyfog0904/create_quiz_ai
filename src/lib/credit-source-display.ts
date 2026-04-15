interface CreditSourcePlanInfo {
  name: string
  price: number
}

export type CreditSourceCategory =
  | 'plan_purchase'
  | 'admin_grant'
  | 'system_refund'
  | 'bonus'
  | 'legacy_unknown'

export type AdminGrantCategory = 'compensation' | 'event' | 'refund' | 'other'

export interface CreditSourceDisplayInput {
  status: 'active' | 'pending_refund' | 'refunded'
  plan: CreditSourcePlanInfo | null
  sourceCategory: CreditSourceCategory
}

function getNonPlanSourceLabel(sourceCategory: CreditSourceCategory): string {
  switch (sourceCategory) {
    case 'admin_grant':
      return '관리자 지급'
    case 'system_refund':
      return '환불'
    case 'bonus':
      return '보너스'
    default:
      return '기타 지급'
  }
}

export function resolveAdminGrantSourceCategory(category: AdminGrantCategory): CreditSourceCategory {
  switch (category) {
    case 'event':
      return 'bonus'
    case 'refund':
      return 'system_refund'
    default:
      return 'admin_grant'
  }
}

export function getCreditSourceCategoryLabel(source: CreditSourceDisplayInput): string {
  const baseLabel = source.plan?.name ?? getNonPlanSourceLabel(source.sourceCategory)

  if (source.plan?.name && source.status === 'refunded') {
    return `${source.plan.name} / 환불`
  }

  return baseLabel
}
