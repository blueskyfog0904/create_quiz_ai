import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { SiteLogoProvider } from '@/components/layout/site-logo'
import { getSiteLogoUrl } from '@/lib/site-logo-server'

export const metadata: Metadata = {
  title: '써머썬 연구소',
  description: '영어와 국어 워크스페이스를 지원하는 문제 생성 플랫폼',
}

// 이 사이트는 밝은 화면만 있다. 브라우저의 강제 다크 모드(삼성 인터넷 등)가 색을 뒤집어 화면이 깨지지 않게 밝은 화면으로 고정한다.
export const viewport: Viewport = {
  colorScheme: 'only light',
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
