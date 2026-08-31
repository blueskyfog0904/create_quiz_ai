import { Suspense, type ReactNode } from 'react'
import { SolvookFooter } from '@/app/(solvook)/_components/solvook-footer'
import { StudioThemeShell } from '@/components/layout/studio-theme-shell'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import { PreviewHeader } from './_components/preview-header'

export default async function SolvookConceptPreviewLayout({
  children,
}: {
  children: ReactNode
}) {
  const [footer, userId] = await Promise.all([
    getSolvookFooterData(),
    getRequestAuthUserId(),
  ])

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        precedence="default"
      />
      <StudioThemeShell>
        <Suspense fallback={null}>
          <PreviewHeader isLoggedIn={Boolean(userId)} />
        </Suspense>
        <main className="flex-1">
          {children}
        </main>
        <SolvookFooter
          cs={footer.cs}
          rows={footer.rows}
          policyLinks={footer.policyLinks}
          brandName={footer.brandName}
          notices={footer.notices}
        />
      </StudioThemeShell>
    </>
  )
}
