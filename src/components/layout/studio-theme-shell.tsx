'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'

// 메인(홈)만 스튜디오 기본 배경(#f7f8fa)을 유지하고, 그 외 페이지는 흰 배경을 쓴다.
const HOME_PATHNAMES = new Set(['/', '/preview/solvook-concept'])

export function StudioThemeShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/'
  const isHome = HOME_PATHNAMES.has(pathname)

  return (
    <div className={`studio-theme flex min-h-screen flex-col ${isHome ? '' : 'bg-[var(--studio-surface)]'}`}>
      {children}
    </div>
  )
}
