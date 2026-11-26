import { Suspense, type ReactNode } from 'react'
import { StudioThemeShell } from '@/components/layout/studio-theme-shell'
import { PreviewHeader } from '@/app/preview/solvook-concept/_components/preview-header'
import { getMarketCartBadgeCount } from '@/lib/market-cart-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import { getActiveSiteNoticePopup } from '@/lib/site-notice-popup-server'
import { SiteNoticePopup } from '@/components/notice/site-notice-popup'
import { SolvookFooter } from '@/app/(solvook)/_components/solvook-footer'

// 약관/정책 페이지도 솔북 컨셉 헤더·푸터를 사용한다 (전역 레거시 크롬은 path-aware에서 제외됨).
export default async function TermsLayout({
  children,
}: {
  children: ReactNode
}) {
  // eslint-disable-next-line react-hooks/purity -- 서버 컴포넌트다. 공지 팝업 노출 기간을 요청 시각으로 판정한다.
  const renderedAt = Date.now()
  const [userId, footer, noticePopup] = await Promise.all([
    getRequestAuthUserId(),
    getSolvookFooterData(),
    getActiveSiteNoticePopup(renderedAt),
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
        {/* 페이지가 자체 <main>을 렌더하므로 landmark 중복을 피해 div로 감싼다 */}
        <div className="flex-1">
          {children}
        </div>
        <SolvookFooter
          cs={footer.cs}
          rows={footer.rows}
          policyLinks={footer.policyLinks}
          brandName={footer.brandName}
          notices={footer.notices}
          boardNav={footer.boardNav}
        />
        <SiteNoticePopup popup={noticePopup} />
      </StudioThemeShell>
    </>
  )
}
