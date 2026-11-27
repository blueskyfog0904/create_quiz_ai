import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { splitMarketHomeTitle } from '@/lib/market-home'

interface SectionHeadingProps {
  title: string
  href?: string
  linkLabel?: string
}

// 섹션 제목은 한글 제목 하나만 둔다(영문 소제목·설명 줄 없음). 제목 안의 **…** 부분은 강조 색으로 그린다.
export function SectionHeading({
  title,
  href,
  linkLabel = '전체 보기',
}: SectionHeadingProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="text-xl font-bold tracking-[-0.02em] text-[var(--studio-ink)] sm:text-2xl">
        {splitMarketHomeTitle(title).map((part, index) => (
          part.emphasis
            ? <span key={index} className="text-[var(--studio-primary)]">{part.text}</span>
            : <span key={index}>{part.text}</span>
        ))}
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
