import { Suspense, type ReactNode } from 'react'
import { cookies } from 'next/headers'
import { PreviewHeader } from '@/app/preview/solvook-concept/_components/preview-header'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { SolvookFooter } from './_components/solvook-footer'

export default async function SolvookHomeLayout({
  children,
}: {
  children: ReactNode
}) {
  const [userId, cookieStore] = await Promise.all([
    getRequestAuthUserId(),
    cookies(),
  ])
  const cookieSubject = cookieStore.get('preferred_workspace')?.value
  const initialSubject: WorkspaceSubject = isWorkspaceSubject(cookieSubject)
    ? cookieSubject
    : 'english'

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        precedence="default"
      />
      <div className="studio-theme flex min-h-screen flex-col">
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
          <SolvookFooter initialSubject={initialSubject} />
        </Suspense>
      </div>
    </>
  )
}
