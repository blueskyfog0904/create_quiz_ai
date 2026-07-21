'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'

const solvookConceptPreviewRoot = '/preview/solvook-concept'

interface PathAwareSiteChromeProps {
  children: ReactNode
  header: ReactNode
  footer: ReactNode
}

export function isSolvookConceptPreviewPath(pathname: string) {
  return (
    pathname === solvookConceptPreviewRoot ||
    pathname.startsWith(`${solvookConceptPreviewRoot}/`)
  )
}

export function PathAwareSiteChrome({
  children,
  header,
  footer,
}: PathAwareSiteChromeProps) {
  const pathname = usePathname() ?? '/'

  if (isSolvookConceptPreviewPath(pathname)) {
    return children
  }

  return (
    <div className="flex min-h-screen flex-col">
      {header}
      <main className="flex-1">
        {children}
      </main>
      {footer}
    </div>
  )
}
