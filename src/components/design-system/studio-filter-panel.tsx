import type { ReactNode } from 'react'

interface StudioFilterPanelProps {
  /** Nested native inputs, selects, and textareas plus shadcn input, select-trigger, and textarea descendants inherit the hit-area contract. */
  fields: ReactNode
  /** Pass removable filter controls as direct children to inherit the hit-area contract. */
  activeFilters?: ReactNode
  /** Pass filter actions as direct children to inherit the hit-area contract. */
  actions?: ReactNode
}

const filterFieldControlClasses =
  '[&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:min-h-11 [&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:min-w-11 [&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:border-[var(--studio-control-border)] [&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:outline-none [&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:focus-visible:ring-2 [&_:is(input,select,textarea,[data-slot=input],[data-slot=select-trigger],[data-slot=textarea])]:focus-visible:ring-[var(--studio-focus-ring)]'

const directActionControlClasses =
  '[&>:is(a,button,[role=button])]:min-h-11 [&>:is(a,button,[role=button])]:min-w-11 [&>:is(a,button,[role=button])]:outline-none [&>:is(a,button,[role=button])]:focus-visible:ring-2 [&>:is(a,button,[role=button])]:focus-visible:ring-[var(--studio-focus-ring)]'

export function StudioFilterPanel({
  fields,
  activeFilters,
  actions,
}: StudioFilterPanelProps) {
  return (
    <section
      aria-label="검색 및 필터"
      className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 shadow-[var(--studio-shadow-card)] sm:p-5"
    >
      <div
        data-slot="studio-filter-fields"
        className={`flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end ${filterFieldControlClasses}`}
      >
        {fields}
      </div>

      {activeFilters || actions ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--studio-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            data-slot="studio-filter-active-filters"
            className={`flex min-w-0 flex-wrap items-center gap-2 ${directActionControlClasses}`}
          >
            {activeFilters}
          </div>
          <div
            data-slot="studio-filter-actions"
            className={`flex flex-wrap items-center gap-2 sm:justify-end ${directActionControlClasses}`}
          >
            {actions}
          </div>
        </div>
      ) : null}
    </section>
  )
}
