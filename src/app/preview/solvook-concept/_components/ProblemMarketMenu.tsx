import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export interface ProblemMarketMenuEntry {
  id: string
  title: string
  href: string
  isCurrent?: boolean
}

const SUBJECT_LABELS: Record<WorkspaceSubject, string> = {
  english: '영어',
  korean: '국어',
}

export function ProblemMarketMenu({
  subject,
  entries,
  className,
}: {
  subject: WorkspaceSubject
  entries: ProblemMarketMenuEntry[]
  className: string
}) {
  const subjectLabel = SUBJECT_LABELS[subject]
  const titleId = `problem-market-menu-title-${subject}`

  return (
    <aside
      data-slot="problem-market-menu"
      aria-labelledby={titleId}
      className={className}
    >
      <h2
        id={titleId}
        className="min-h-11 text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)]"
      >
        {subjectLabel}
      </h2>

      <nav aria-label={`${subjectLabel} 문제마켓 카테고리`} className="mt-5">
        <details open className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 outline-none [&::-webkit-details-marker]:hidden hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]">
            <h3 className="break-keep text-base font-extrabold text-[var(--studio-ink)]">
              {subjectLabel} 문제마켓
            </h3>
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[var(--studio-text)] transition-transform group-open:rotate-180"
            />
          </summary>

          {entries.length === 0 ? (
            <p className="py-4 pl-4 text-sm leading-5 text-[var(--studio-muted)]">
              등록된 카테고리가 없습니다.
            </p>
          ) : (
            <ul className="mt-1 space-y-1 pl-4">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    href={entry.href}
                    aria-current={entry.isCurrent ? 'page' : undefined}
                    className={`flex min-h-11 items-center rounded-[var(--studio-radius-control)] px-3 py-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                      entry.isCurrent
                        ? 'text-[var(--studio-primary)]'
                        : 'text-[var(--studio-muted)] hover:bg-[var(--studio-primary-soft)] hover:text-[var(--studio-primary)]'
                    }`}
                  >
                    <span className="min-w-0 break-keep">{entry.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </details>
      </nav>
    </aside>
  )
}
