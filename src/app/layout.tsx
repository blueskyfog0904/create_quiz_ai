import type { Metadata } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { SiteLogoProvider } from '@/components/layout/site-logo'
import { getSiteLogoUrl } from '@/lib/site-logo-server'

export const metadata: Metadata = {
  title: '써머썬 연구소',
  description: '영어와 국어 워크스페이스를 지원하는 문제 생성 플랫폼',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const logoUrl = await getSiteLogoUrl()
  return (
    <html lang="ko">
      <body className="antialiased font-sans">
        <SiteLogoProvider url={logoUrl}>{children}</SiteLogoProvider>
        <Toaster />
      </body>
    </html>
  )
}
