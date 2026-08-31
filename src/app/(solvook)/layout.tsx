import { Suspense, type ReactNode } from 'react'
import { StudioThemeShell } from '@/components/layout/studio-theme-shell'
import { PreviewHeader } from '@/app/preview/solvook-concept/_components/preview-header'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SolvookFooter } from './_components/solvook-footer'

export default async function SolvookHomeLayout({
  children,
}: {
  children: ReactNode
}) {
  const [userId, footer] = await Promise.all([
    getRequestAuthUserId(),
    getSolvookFooterData(),
  ])
  // 홈 초기 과목은 항상 영어. 쿼리(?subject=)는 헤더/홈뷰가 useSearchParams로 즉시 반영한다.
  const initialSubject: WorkspaceSubject = 'english'

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
