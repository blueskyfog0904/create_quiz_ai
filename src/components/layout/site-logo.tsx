'use client'

import { createContext, useContext, type ReactNode } from 'react'
import Image from 'next/image'
import { DEFAULT_SITE_LOGO_PATH } from '@/lib/site-logo'

const SiteLogoContext = createContext<string | null>(null)

export function SiteLogoProvider({ url, children }: { url: string | null; children: ReactNode }) {
  return <SiteLogoContext.Provider value={url}>{children}</SiteLogoContext.Provider>
}

export function useSiteLogoUrl() {
  return useContext(SiteLogoContext)
}

export function SiteLogo({ size, className }: { size: number; className?: string }) {
  const url = useSiteLogoUrl()
  return (
    <Image
      src={url || DEFAULT_SITE_LOGO_PATH}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
      unoptimized
    />
  )
}
