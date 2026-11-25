import 'server-only'

import { unstable_cache } from 'next/cache'
import {
  getFooterBrandName,
  getVisibleFooterPolicyLinks,
  getVisibleFooterRows,
} from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { getSiteBrand } from '@/lib/site-brand-server'
import { POLICY_UPCOMING_PATH } from '@/lib/site-notice-popup'
import { getUpcomingPolicySummary } from '@/lib/site-notice-popup-server'

export interface SolvookFooterData {
  cs: { phone: string; hours: string; email: string }
  rows: { label: string; value: string }[][]
  policyLinks: { key: string; label: string; href: string }[]
  brandName: string
  notices: string[]
}

// 푸터 내용은 어드민이 드물게 수정하는 site_footer_content 설정이라 60초 공유 캐시로 읽는다.
const getCachedFooterContent = unstable_cache(
  () => getSiteFooterContent(),
  ['solvook-footer-content'],
  { revalidate: 60 }
)

export async function getSolvookFooterData(): Promise<SolvookFooterData> {
  // 변경 예정 글 가벼운 읽기는 실패하면 null 을 돌려준다(하단 링크만 빠지고 화면은 그대로).
  const [footerContent, siteBrand, upcoming] = await Promise.all([getCachedFooterContent(), getSiteBrand(), getUpcomingPolicySummary()])
  const fields = footerContent.fixedFields
  const policyLinks: SolvookFooterData['policyLinks'] = getVisibleFooterPolicyLinks(footerContent).map((link) => ({
    key: link.key,
    label: link.label,
    href: link.href,
  }))
  // 고지 기간(upcoming)에만 정책 링크 끝에 '변경 예정 약관' 링크(글은 DB 값). 시행·되돌리기 뒤에는 저절로 사라진다.
  if (upcoming?.status === 'upcoming' && upcoming.footerLinkLabel) {
    policyLinks.push({ key: 'policyUpcoming', label: upcoming.footerLinkLabel, href: POLICY_UPCOMING_PATH })
  }

  return {
    cs: {
      phone: fields.customerCenter.enabled ? fields.customerCenter.value.trim() : '',
      hours: fields.csHours.enabled ? fields.csHours.value.trim() : '',
      email: fields.orderEmail.enabled ? fields.orderEmail.value.trim() : '',
    },
    rows: getVisibleFooterRows(footerContent).map((row) =>
      row.map((field) => ({ label: field.label, value: field.value.trim() }))
    ),
    policyLinks,
    brandName: getFooterBrandName(footerContent, siteBrand.name),
    notices: footerContent.extraNotices,
  }
}
