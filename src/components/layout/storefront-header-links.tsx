'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { StorefrontHeaderLink } from '@/lib/storefront-header-links'

// 회원 헤더 오른쪽 운영 링크(관리자 "상단 메뉴"). 값은 루트 레이아웃이 DB에서 읽어 내려 준다.
const StorefrontHeaderLinksContext = createContext<StorefrontHeaderLink[]>([])

export function StorefrontHeaderLinksProvider({ links, children }: { links: StorefrontHeaderLink[]; children: ReactNode }) {
  return <StorefrontHeaderLinksContext.Provider value={links}>{children}</StorefrontHeaderLinksContext.Provider>
}

export function useStorefrontHeaderLinks() {
  return useContext(StorefrontHeaderLinksContext)
}
