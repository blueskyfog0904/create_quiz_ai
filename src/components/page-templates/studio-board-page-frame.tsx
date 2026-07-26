import type { ReactNode } from 'react'

import { StudioContainer } from '@/components/design-system/studio-container'

interface StudioBoardPageFrameProps {
  header: ReactNode
  filters?: ReactNode
  results: ReactNode
}

export function StudioBoardPageFrame({
  header,
  filters,
  results,
}: StudioBoardPageFrameProps) {
  return (
    <div className="studio-theme min-h-screen">
      {header}
      <StudioContainer className="space-y-6 py-7 sm:py-9">
        {filters}
        {results}
      </StudioContainer>
    </div>
  )
}
