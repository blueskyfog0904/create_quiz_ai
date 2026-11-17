import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { SiteLogoProvider } from '@/components/layout/site-logo'
import { getSiteLogoUrl } from '@/lib/site-logo-server'

export const metadata: Metadata = {
  title: '써머썬 연구소',
  // 홈((solvook)/page.tsx)은 설명을 따로 적지 않고 이 값을 물려받는다.
  description: '영어와 국어 수업 자료를 과목별로 탐색하는 선생님용 문제마켓',
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
