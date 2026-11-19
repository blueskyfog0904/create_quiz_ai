import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

interface SectionHeadingProps {
  title: string
  href?: string
  linkLabel?: string
}

// 섹션 제목은 한글 제목 하나만 둔다(영문 소제목·설명 줄 없음).
export function SectionHeading({
  title,
  href,
  linkLabel = '전체 보기',
}: SectionHeadingProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="text-xl font-bold tracking-[-0.02em] text-[var(--studio-ink)] sm:text-2xl">
        {title}
      </h2>

      {href ? (
        <Link
          href={href}
          className="hidden min-h-11 min-w-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-bold text-[var(--studio-text)] outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] sm:inline-flex"
        >
          {linkLabel}
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  )
}
