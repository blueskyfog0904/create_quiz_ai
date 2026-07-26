import type { ReactNode } from 'react'

import { StudioContainer } from '@/components/design-system/studio-container'

interface StudioLandingPageFrameProps {
  hero: ReactNode
  children: ReactNode
}

export function StudioLandingPageFrame({
  hero,
  children,
}: StudioLandingPageFrameProps) {
  return (
    <div className="studio-theme studio-reference-gutter min-h-screen overflow-x-hidden">
      {hero}
      <StudioContainer className="space-y-12 py-10 sm:space-y-16 sm:py-14">
        {children}
      </StudioContainer>
    </div>
  )
}
