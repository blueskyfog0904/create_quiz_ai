import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getActiveHeaderNavigationItems, resolveHeaderMenuHref } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import LibrarySidebar from '@/app/(dashboard)/library/library-sidebar'

interface WorkspaceLibraryLayoutProps {
  children: ReactNode
  params: Promise<Record<string, string | string[] | undefined>>
}

export default async function WorkspaceLibraryLayout({
  children,
  params,
}: WorkspaceLibraryLayoutProps) {
  const resolvedParams = await params
  const workspaceSubject = Array.isArray(resolvedParams.workspaceSubject)
    ? resolvedParams.workspaceSubject[0]
    : resolvedParams.workspaceSubject

  if (!isWorkspaceSubject(workspaceSubject)) {
    notFound()
  }

  const navigationConfig = await getHeaderNavigationConfig(workspaceSubject)
  const activeNavigationItems = getActiveHeaderNavigationItems(navigationConfig.items)
  const libraryMenu = activeNavigationItems.find((item) => {
    if (item.href === '/library') return true
    return item.children.some((child) => child.href.startsWith('/library/'))
  })
  const librarySidebarItems = libraryMenu
    ? libraryMenu.children.map((child) => ({
        ...child,
        href: resolveHeaderMenuHref(libraryMenu.href, child.href),
      }))
    : []

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {librarySidebarItems.length ? (
          <LibrarySidebar parentTitle={libraryMenu?.title ?? '라이브러리'} items={librarySidebarItems} />
        ) : null}
        <div className="min-w-0 flex-1 [&_.container]:mx-0 [&_.container]:max-w-none [&_.container]:px-0 [&_.container]:py-0">
          {children}
        </div>
      </div>
    </div>
  )
}
