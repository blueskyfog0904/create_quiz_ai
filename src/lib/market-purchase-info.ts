import {
  getVisibleFooterPolicyLinks,
  type FooterContentConfig,
  type FooterFixedFieldKey,
} from '@/lib/footer-content'

// 상품 상세 "구매 전 확인"·구매 확인창에 쓰는 하단 정보(공급자·약관 링크). 값은 하단 정보(DB) 그대로.
export interface MarketPurchaseLink {
  label: string
  href: string
}

export interface MarketPurchaseInfo {
  // 상호·대표자·주소·고객센터·이메일 중 값이 있는 줄(하단 표시 여부와 관계없이)
  supplierRows: { label: string; value: string }[]
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
}

const MARKET_PURCHASE_SUPPLIER_FIELD_KEYS = [
  'companyName',
  'representativeName',
  'businessAddress',
  'customerCenter',
  'orderEmail',
] as const satisfies readonly FooterFixedFieldKey[]

export function buildMarketPurchaseInfo(footer: FooterContentConfig): MarketPurchaseInfo {
  const links = getVisibleFooterPolicyLinks(footer)
  const toLink = (key: 'serviceTerms' | 'refundPolicy'): MarketPurchaseLink | null => {
    const link = links.find((candidate) => candidate.key === key)
    return link ? { label: link.label, href: link.href } : null
  }
  return {
    supplierRows: MARKET_PURCHASE_SUPPLIER_FIELD_KEYS
      .map((key) => footer.fixedFields[key])
      .filter((field) => field.value.trim())
      .map((field) => ({ label: field.label.trim(), value: field.value.trim() })),
    termsLink: toLink('serviceTerms'),
    refundPolicyLink: toLink('refundPolicy'),
  }
}
