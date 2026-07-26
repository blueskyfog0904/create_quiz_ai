import type * as React from 'react'

import { cn } from '@/lib/utils'

export function StudioContainer({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="studio-container"
      className={cn(
        'mx-auto w-full max-w-[var(--studio-content-width,75rem)] px-4 sm:px-6',
        className
      )}
      {...props}
    />
  )
}
