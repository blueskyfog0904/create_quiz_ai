import type { ReactNode } from 'react'

import { StudioContainer } from '@/components/design-system/studio-container'
import { cn } from '@/lib/utils'

interface StudioDetailPageFrameProps {
  header: ReactNode
  main: ReactNode
  aside?: ReactNode
  tabs?: ReactNode
  mobileActions?: ReactNode
}

export function StudioDetailPageFrame({
  header,
  main,
  aside,
  tabs,
  mobileActions,
}: StudioDetailPageFrameProps) {
  const hasAside = aside != null
  const hasMobileActions = mobileActions != null

  return (
    <div
      className={cn(
        'studio-theme min-h-screen',
        hasMobileActions && 'pb-32 lg:pb-0'
      )}
    >
      {header}
      <StudioContainer className="py-7 sm:py-9">
        <div
          className={cn(
            'grid gap-6',
            hasAside && 'lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start'
          )}
        >
          <div data-slot="studio-detail-main" className="min-w-0 space-y-6">
            {main}
            {tabs}
          </div>
          {hasAside ? <aside className="hidden lg:block">{aside}</aside> : null}
        </div>
      </StudioContainer>
      {hasMobileActions ? (
        <div
          data-slot="studio-detail-mobile-actions"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--studio-border)] bg-[var(--studio-surface)] px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[var(--studio-shadow-card)] lg:hidden"
        >
          {mobileActions}
        </div>
      ) : null}
    </div>
  )
}
