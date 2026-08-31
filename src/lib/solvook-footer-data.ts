import 'server-only'

import { unstable_cache } from 'next/cache'
import {
  getFooterBrandName,
  getVisibleFooterPolicyLinks,
  getVisibleFooterRows,
} from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'

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
  const footerContent = await getCachedFooterContent()
  const fields = footerContent.fixedFields

  return {
    cs: {
      phone: fields.customerCenter.enabled ? fields.customerCenter.value.trim() : '',
      hours: fields.csHours.enabled ? fields.csHours.value.trim() : '',
      email: fields.orderEmail.enabled ? fields.orderEmail.value.trim() : '',
    },
    rows: getVisibleFooterRows(footerContent).map((row) =>
      row.map((field) => ({ label: field.label, value: field.value.trim() }))
    ),
    policyLinks: getVisibleFooterPolicyLinks(footerContent).map((link) => ({
      key: link.key,
      label: link.label,
      href: link.href,
    })),
    brandName: getFooterBrandName(footerContent),
    notices: footerContent.extraNotices,
  }
}
