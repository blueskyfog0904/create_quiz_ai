import { Suspense, type ReactNode } from 'react'
import { StudioThemeShell } from '@/components/layout/studio-theme-shell'
import { PreviewHeader } from '@/app/preview/solvook-concept/_components/preview-header'
import { getMarketCartBadgeCount } from '@/lib/market-cart-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { getSolvookFooterData } from '@/lib/solvook-footer-data'
import { getActiveSiteNoticePopup } from '@/lib/site-notice-popup-server'
import { SiteNoticePopup } from '@/components/notice/site-notice-popup'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SolvookFooter } from './_components/solvook-footer'
import { MemberRestrictionBanner } from './_components/member-restriction-banner'

export default async function SolvookHomeLayout({
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
  // 홈 초기 과목은 항상 국어. 쿼리(?subject=)는 헤더/홈뷰가 useSearchParams로 즉시 반영한다.
  const initialSubject: WorkspaceSubject = 'korean'

  return (
    <>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        precedence="default"
      />
      <StudioThemeShell>
        {/* 12번 5-3: 이용 제한 회원 한 줄 안내(미들웨어 헤더). /checkout 은 이 틀을 다시 내보내므로 한 번만 그려진다. */}
        {userId && <MemberRestrictionBanner />}
        <Suspense fallback={null}>
          <PreviewHeader
            isLoggedIn={Boolean(userId)}
            initialSubject={initialSubject}
            userId={userId}
            cartCount={cartCount}
          />
        </Suspense>
        <main className="flex-1">
          {children}
        </main>
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
