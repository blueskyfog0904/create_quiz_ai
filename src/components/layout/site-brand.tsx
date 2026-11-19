'use client'

import { createContext, useContext, type ReactNode } from 'react'

// 사이트 이름을 클라이언트 화면(헤더 등)에 내려 준다. 값은 루트 레이아웃이 DB에서 읽는다.
const SiteBrandNameContext = createContext<string>('')

export function SiteBrandProvider({ name, children }: { name: string; children: ReactNode }) {
  return <SiteBrandNameContext.Provider value={name}>{children}</SiteBrandNameContext.Provider>
}

export function useSiteBrandName() {
  return useContext(SiteBrandNameContext)
}
