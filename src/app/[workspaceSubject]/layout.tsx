import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { SiteChrome } from '@/components/layout/site-chrome'
import { isWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamicParams = false

export function generateStaticParams() {
  return [
    { workspaceSubject: 'english' },
    { workspaceSubject: 'korean' },
  ]
}

interface WorkspaceSubjectLayoutProps {
  children: ReactNode
  params: Promise<Record<string, string | string[] | undefined>>
}

export default async function WorkspaceSubjectLayout({
  children,
  params,
}: WorkspaceSubjectLayoutProps) {
  const resolvedParams = await params
  const workspaceSubject = Array.isArray(resolvedParams.workspaceSubject)
    ? resolvedParams.workspaceSubject[0]
    : resolvedParams.workspaceSubject

  if (!isWorkspaceSubject(workspaceSubject)) {
    notFound()
  }

  return <SiteChrome>{children}</SiteChrome>
}
