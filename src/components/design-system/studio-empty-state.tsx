import type { ReactNode } from 'react'

interface StudioEmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  /** Pass focusable action controls as direct children so hit-area and focus defaults apply. */
  action?: ReactNode
}

export function StudioEmptyState({
  icon,
  title,
  description,
  action,
}: StudioEmptyStateProps) {
  return (
    <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-10 text-center shadow-[var(--studio-shadow-card)] sm:px-8 sm:py-12">
      {icon ? (
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
          {icon}
        </div>
      ) : null}
      <p className="mt-4 text-xl font-extrabold text-[var(--studio-ink)]">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-lg break-keep text-sm leading-6 text-[var(--studio-muted)]">
        {description}
      </p>
      {action ? (
        <div
          data-slot="studio-empty-state-action"
          className="mt-6 flex flex-wrap items-center justify-center gap-2 [&>:is(a,button,input,select,[role=button])]:min-h-11 [&>:is(a,button,input,select,[role=button])]:min-w-11 [&>:is(a,button,input,select,[role=button])]:outline-none [&>:is(a,button,input,select,[role=button])]:focus-visible:ring-2 [&>:is(a,button,input,select,[role=button])]:focus-visible:ring-[var(--studio-focus-ring)] [&>a]:inline-flex [&>a]:items-center [&>a]:justify-center [&>[role=button]]:inline-flex [&>[role=button]]:items-center [&>[role=button]]:justify-center"
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
