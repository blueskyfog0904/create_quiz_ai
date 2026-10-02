import { Suspense, type ReactNode } from 'react'
import { StudioThemeShell } from '@/components/layout/studio-theme-shell'
import { PreviewHeader } from '@/app/preview/solvook-concept/_components/preview-header'
import { getMarketCartBadgeCount } from '@/lib/market-cart-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import { SolvookFooter } from '@/app/(solvook)/_components/solvook-footer'

// 로그인·회원가입 페이지도 솔북 컨셉 헤더·푸터를 사용한다 (전역 레거시 크롬은 path-aware에서 제외됨).
export default async function AuthLayout({
  children,
}: {
  children: ReactNode
}) {
  const [userId, footer] = await Promise.all([
    getRequestAuthUserId(),
    getSolvookFooterData(),
  ])
  const cartCount = await getMarketCartBadgeCount(userId)

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        precedence="default"
      />
      <StudioThemeShell>
        <Suspense fallback={null}>
          <PreviewHeader isLoggedIn={Boolean(userId)} userId={userId} cartCount={cartCount} />
        </Suspense>
        {/* 로그인·회원가입 페이지는 자체 main landmark가 없으므로 여기서 하나 둔다 */}
        <main className="flex-1">
          {children}
        </main>
        <SolvookFooter
          cs={footer.cs}
          rows={footer.rows}
          policyLinks={footer.policyLinks}
          brandName={footer.brandName}
          notices={footer.notices}
        />
      </StudioThemeShell>
    </>
  )
}
