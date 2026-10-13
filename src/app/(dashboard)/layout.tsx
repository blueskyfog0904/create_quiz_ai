import type { ReactNode } from 'react'
import { SiteChrome } from '@/components/layout/site-chrome'

export default function SiteChromeLayout({ children }: { children: ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>
}
