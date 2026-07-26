import type * as React from 'react'

import { StudioContainer } from './studio-container'

interface StudioPageHeaderProps {
  breadcrumbs?: React.ReactNode
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
  /** Pass focusable action controls as direct children so hit-area and focus defaults apply. */
  actions?: React.ReactNode
}

export function StudioPageHeader({
  breadcrumbs,
  eyebrow,
  title,
  description,
  meta,
  actions,
}: StudioPageHeaderProps) {
  return (
    <header className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <StudioContainer className="py-9 sm:py-12">
        {breadcrumbs ? (
          <nav
            aria-label="Breadcrumb"
            className="mb-6 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--studio-muted)]"
          >
            {breadcrumbs}
          </nav>
        ) : null}

        {eyebrow ? (
          <div className="text-xs font-extrabold tracking-[0.13em] text-[var(--studio-primary)]">
            {eyebrow}
          </div>
        ) : null}

        <div className="mt-2 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="min-w-0">
            <h1 className="break-keep text-3xl font-black tracking-[-0.04em] text-[var(--studio-ink)] sm:text-4xl">
              {title}
            </h1>
            {description ? (
              <div className="mt-3 max-w-2xl break-keep text-sm leading-6 text-[var(--studio-muted)]">
                {description}
              </div>
            ) : null}
            {meta ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--studio-text)]">
                {meta}
              </div>
            ) : null}
          </div>

          {actions ? (
            <div
              data-slot="studio-page-header-actions"
              className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 md:w-auto md:shrink-0 [&>:is(a,button,input,select,[role=button])]:min-h-11 [&>:is(a,button,input,select,[role=button])]:min-w-11 [&>:is(a,button,input,select,[role=button])]:outline-none [&>:is(a,button,input,select,[role=button])]:focus-visible:ring-2 [&>:is(a,button,input,select,[role=button])]:focus-visible:ring-[var(--studio-focus-ring)] [&>a]:inline-flex [&>a]:items-center [&>a]:justify-center [&>[role=button]]:inline-flex [&>[role=button]]:items-center [&>[role=button]]:justify-center"
            >
              {actions}
            </div>
          ) : null}
        </div>
      </StudioContainer>
    </header>
  )
}
