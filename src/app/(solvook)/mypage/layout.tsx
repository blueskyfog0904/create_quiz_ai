import type { ReactNode } from 'react'
import { StudioContainer } from '@/components/design-system/studio-container'
import { isRequestMemberRestricted } from '@/lib/member-suspension-server'
import { getMemberSuspensionPolicyCached } from '@/lib/member-suspension-policy-server'
import { MypageSideNav } from './_components/mypage-side-nav'

// 마이페이지 공통 틀: 왼쪽(모바일은 위쪽) 메뉴 + 내용. 12번: 이용 제한 중일 때만 안내 화면 메뉴를 보인다(미들웨어 헤더).
export default async function MypageLayout({ children }: { children: ReactNode }) {
  // 메뉴 이름은 안내 화면 제목(정책 texts.noticeTitle)이다. 정책을 읽지 못하면 메뉴는 숨긴다(한 줄 안내의 링크는 남음).
  const restrictionLabel = (await isRequestMemberRestricted()) ? (await getMemberSuspensionPolicyCached())?.texts.noticeTitle ?? null : null
  return (
    <StudioContainer className="py-8 sm:py-10">
      <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <MypageSideNav restrictionLabel={restrictionLabel} />
        <div className="min-w-0">{children}</div>
      </div>
    </StudioContainer>
  )
}
