import { Suspense, type ReactNode } from 'react'
import { unstable_cache } from 'next/cache'
import { StudioThemeShell } from '@/components/layout/studio-theme-shell'
import { PreviewHeader } from '@/app/preview/solvook-concept/_components/preview-header'
import {
  getFooterBrandName,
  getVisibleFooterPolicyLinks,
  getVisibleFooterRows,
} from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SolvookFooter } from './_components/solvook-footer'

// 푸터 내용은 어드민이 드물게 수정하는 site_footer_content 설정이라 60초 공유 캐시로 읽는다.
const getCachedFooterContent = unstable_cache(
  () => getSiteFooterContent(),
  ['solvook-footer-content'],
  { revalidate: 60 }
)

export default async function SolvookHomeLayout({
  children,
}: {
  children: ReactNode
}) {
  const [userId, footerContent] = await Promise.all([
    getRequestAuthUserId(),
    getCachedFooterContent(),
  ])
  // 홈 초기 과목은 항상 영어. 쿼리(?subject=)는 헤더/홈뷰가 useSearchParams로 즉시 반영한다.
  const initialSubject: WorkspaceSubject = 'english'

  const footerFields = footerContent.fixedFields
  const footerCs = {
    phone: footerFields.customerCenter.enabled ? footerFields.customerCenter.value.trim() : '',
    hours: footerFields.csHours.enabled ? footerFields.csHours.value.trim() : '',
    email: footerFields.orderEmail.enabled ? footerFields.orderEmail.value.trim() : '',
  }
  const footerRows = getVisibleFooterRows(footerContent).map((row) =>
    row.map((field) => ({ label: field.label, value: field.value.trim() }))
  )
  const footerPolicyLinks = getVisibleFooterPolicyLinks(footerContent).map((link) => ({
    key: link.key,
    label: link.label,
    href: link.href,
  }))
  const footerBrandName = getFooterBrandName(footerContent)
  const footerNotices = footerContent.extraNotices

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        precedence="default"
      />
      <StudioThemeShell>
        <Suspense fallback={null}>
          <PreviewHeader
            isLoggedIn={Boolean(userId)}
            initialSubject={initialSubject}
          />
        </Suspense>
        <main className="flex-1">
          {children}
        </main>
        <Suspense fallback={null}>
          <SolvookFooter
            initialSubject={initialSubject}
            cs={footerCs}
            rows={footerRows}
            policyLinks={footerPolicyLinks}
            brandName={footerBrandName}
            notices={footerNotices}
          />
        </Suspense>
      </StudioThemeShell>
    </>
  )
}
