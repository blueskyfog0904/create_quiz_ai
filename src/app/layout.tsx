import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { SiteBrandProvider } from '@/components/layout/site-brand'
import { SiteLogoProvider } from '@/components/layout/site-logo'
import { StorefrontHeaderLinksProvider } from '@/components/layout/storefront-header-links'
import { buildSiteTitleTemplate } from '@/lib/site-brand'
import { getSiteBrand } from '@/lib/site-brand-server'
import { DEFAULT_SITE_LOGO_PATH } from '@/lib/site-logo'
import { getSiteLogoUrl, getSiteTabIconUrl } from '@/lib/site-logo-server'
import { getActiveStorefrontHeaderLinks } from '@/lib/storefront-header-links-server'

// 사이트 이름·소개 문구는 DB(관리자 "사이트 기본 정보")에서 읽는다.
// 각 화면은 제목에 화면 이름만 적고, 뒤의 " | 사이트 이름"은 이 템플릿이 붙인다.
// 홈((solvook)/page.tsx)은 설명을 따로 적지 않고 이 값을 물려받는다.
export async function generateMetadata(): Promise<Metadata> {
  const [brand, tabIconUrl, logoUrl] = await Promise.all([getSiteBrand(), getSiteTabIconUrl(), getSiteLogoUrl()])
  // 탭 아이콘: 관리자에서 따로 올린 탭 아이콘 → 없으면 사이트 로고 → 그것도 없으면 기본 이미지
  const icon = tabIconUrl ?? logoUrl ?? DEFAULT_SITE_LOGO_PATH
  return {
    title: { default: brand.name, template: buildSiteTitleTemplate(brand) },
    icons: { icon, apple: icon },
    ...(brand.description ? { description: brand.description } : {}),
  }
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
  const [logoUrl, brand, headerLinks] = await Promise.all([getSiteLogoUrl(), getSiteBrand(), getActiveStorefrontHeaderLinks()])
  return (
    <html lang="ko">
      <body className="antialiased font-sans">
        <SiteBrandProvider name={brand.name}>
          <SiteLogoProvider url={logoUrl}>
            <StorefrontHeaderLinksProvider links={headerLinks}>{children}</StorefrontHeaderLinksProvider>
          </SiteLogoProvider>
        </SiteBrandProvider>
        <Toaster />
      </body>
    </html>
  )
}
