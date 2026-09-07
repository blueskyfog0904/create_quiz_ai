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

  // 루트(/)와 자료 보관함(/library)은 솔북 컨셉 레이아웃이 자체 헤더/푸터를 렌더하므로 전역 크롬을 생략한다.
  if (pathname === '/' || pathname === '/library' || pathname === '/search' || pathname === '/categories' || pathname.startsWith('/categories/') || pathname === '/mypage' || pathname.startsWith('/mypage/') || pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/terms' || pathname.startsWith('/terms/') || isSolvookConceptPreviewPath(pathname)) {
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
