import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

interface SectionHeadingProps {
  eyebrow: string
  title: string
  description?: string
  href?: string
  linkLabel?: string
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  href,
  linkLabel = '전체 보기',
}: SectionHeadingProps) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-extrabold tracking-[0.14em] text-[var(--preview-primary)]">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.035em] text-[var(--preview-ink)] sm:text-[28px]">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 max-w-2xl break-keep text-sm leading-6 text-[var(--preview-muted)]">
            {description}
          </p>
        ) : null}
      </div>

      {href ? (
        <Link
          href={href}
          className="hidden min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-bold text-[var(--preview-text)] outline-none transition-colors hover:text-[var(--preview-primary)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] sm:inline-flex"
        >
          {linkLabel}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  )
}
