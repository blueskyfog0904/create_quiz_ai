import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import GenerateSidebar from '@/app/(dashboard)/generate/generate-sidebar'

interface WorkspaceGenerateLayoutProps {
  children: ReactNode
  params: Promise<{ workspaceSubject: string }>
}

export default async function WorkspaceGenerateLayout({
  children,
  params,
}: WorkspaceGenerateLayoutProps) {
  const { workspaceSubject } = await params

  if (!isWorkspaceSubject(workspaceSubject)) {
    notFound()
  }

  const navigationConfig = await getHeaderNavigationConfig(workspaceSubject)
  const activeNavigationItems = getActiveHeaderNavigationItems(navigationConfig.items)
  const generateMenu = activeNavigationItems.find((item) => {
    if (item.href === '/generate') return true
    return item.children.some((child) => child.href.startsWith('/generate/'))
  })

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {generateMenu?.children.length ? (
          <GenerateSidebar parentTitle={generateMenu.title} items={generateMenu.children} />
        ) : null}
        <div className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
