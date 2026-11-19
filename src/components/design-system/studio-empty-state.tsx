import type { ReactNode } from 'react'

interface StudioEmptyStateProps {
  title: string
  description: string
  /** Pass focusable action controls as direct children so hit-area and focus defaults apply. */
  action?: ReactNode
}

// 빈 화면: 아이콘·그림자 없이 짧은 제목과 안내, 필요하면 버튼 하나.
export function StudioEmptyState({
  title,
  description,
  action,
}: StudioEmptyStateProps) {
  return (
    <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-12 text-center sm:px-8 sm:py-16">
      <p className="text-base font-semibold text-[var(--studio-text)]">
        {title}
      </p>
      <p className="mx-auto mt-1.5 max-w-lg break-keep text-sm leading-6 text-[var(--studio-muted)]">
        {description}
      </p>
      {action ? (
        <div
          data-slot="studio-empty-state-action"
          className="mt-5 flex flex-wrap items-center justify-center gap-2 [&>:is(a,button,input,select,[role=button])]:min-h-11 [&>:is(a,button,input,select,[role=button])]:min-w-11 [&>:is(a,button,input,select,[role=button])]:outline-none [&>:is(a,button,input,select,[role=button])]:focus-visible:ring-2 [&>:is(a,button,input,select,[role=button])]:focus-visible:ring-[var(--studio-focus-ring)] [&>a]:inline-flex [&>a]:items-center [&>a]:justify-center [&>[role=button]]:inline-flex [&>[role=button]]:items-center [&>[role=button]]:justify-center"
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
