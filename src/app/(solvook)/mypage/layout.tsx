import type { ReactNode } from 'react'
import { StudioContainer } from '@/components/design-system/studio-container'
import { MypageSideNav } from './_components/mypage-side-nav'

// 마이페이지 공통 틀: 왼쪽(모바일은 위쪽) 메뉴 + 내용
export default function MypageLayout({ children }: { children: ReactNode }) {
  return (
    <StudioContainer className="py-8 sm:py-10">
      <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <MypageSideNav />
        <div className="min-w-0">{children}</div>
      </div>
    </StudioContainer>
  )
}
