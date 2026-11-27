import { getVisibleFooterPolicyLinks, type FooterContentConfig } from '@/lib/footer-content'

// 상품 상세 "구매 전 확인"·구매 확인창에 쓰는 하단 정보(약관 링크). 값은 하단 정보(DB) 그대로.
export interface MarketPurchaseLink {
  label: string
  href: string
}

export interface MarketPurchaseInfo {
  termsLink: MarketPurchaseLink | null
  refundPolicyLink: MarketPurchaseLink | null
}

export function buildMarketPurchaseInfo(footer: FooterContentConfig): MarketPurchaseInfo {
  const links = getVisibleFooterPolicyLinks(footer)
  const toLink = (key: 'serviceTerms' | 'refundPolicy'): MarketPurchaseLink | null => {
    const link = links.find((candidate) => candidate.key === key)
    return link ? { label: link.label, href: link.href } : null
  }
  return {
    termsLink: toLink('serviceTerms'),
    refundPolicyLink: toLink('refundPolicy'),
  }
}
