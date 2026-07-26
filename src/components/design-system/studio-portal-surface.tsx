'use client'

import * as React from 'react'

import { DialogContent } from '@/components/ui/dialog'
import { SelectContent } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export const studioPortalSurfaceClass =
  'border-[var(--studio-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] [font-family:var(--studio-font-sans)] [--background:var(--studio-surface)] [--foreground:var(--studio-text)] [--popover:var(--studio-surface)] [--popover-foreground:var(--studio-text)] [--accent:var(--studio-primary-soft)] [--accent-foreground:var(--studio-primary)] [--ring:var(--studio-focus-ring)]'

function StudioDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        studioPortalSurfaceClass,
        '[&_[data-slot=dialog-close]]:size-11',
        '[&_[data-slot=dialog-header]]:pr-16',
        className
      )}
      {...props}
    />
  )
}

function StudioSelectContent({
  className,
  ...props
}: React.ComponentProps<typeof SelectContent>) {
  return (
    <SelectContent
      className={cn(
        studioPortalSurfaceClass,
        '[&_[data-slot=select-item]]:min-h-11 [&_[data-slot=select-item]]:min-w-11',
        className
      )}
      {...props}
    />
  )
}

export { StudioDialogContent, StudioSelectContent }
