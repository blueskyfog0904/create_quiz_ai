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

  // 루트(/)는 솔북 컨셉 홈이 자체 헤더/푸터를 렌더하므로 전역 크롬을 생략한다.
  if (pathname === '/' || isSolvookConceptPreviewPath(pathname)) {
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
