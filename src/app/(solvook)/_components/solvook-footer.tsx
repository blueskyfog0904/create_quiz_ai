'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { StudioContainer } from '@/components/design-system'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface SolvookFooterProps {
  initialSubject?: WorkspaceSubject
}

export function SolvookFooter({ initialSubject = 'english' }: SolvookFooterProps) {
  const searchParams = useSearchParams()
  const paramSubject = searchParams.get('subject')
  const subject: WorkspaceSubject =
    paramSubject === 'korean' || paramSubject === 'english'
      ? paramSubject
      : initialSubject
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const marketHref = `/${subject}/market/entexam`

  return (
    <footer className="studio-reference-gutter mt-auto border-t border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <StudioContainer className="grid gap-8 py-10 md:grid-cols-[1.4fr_1fr]">
        <div>
          <Link
            href={`/?subject=${subject}`}
            className="inline-flex min-h-11 min-w-11 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
          >
            <Image
              src="/brand-mark.svg"
              alt=""
              aria-hidden="true"
              width={34}
              height={34}
            />
            <span className="font-extrabold tracking-[-0.02em] text-[var(--studio-ink)]">
              써머썬 스튜디오
            </span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-6 text-[var(--studio-muted)]">
            수업에 필요한 {subjectLabel} 문제와 교재별 자료를 탐색하는
            선생님용 문제마켓입니다.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-bold text-[var(--studio-ink)]">자료 탐색</h2>
          <nav aria-label="푸터 자료 탐색" className="mt-3 flex flex-col items-start gap-2 text-sm">
            <Link
              className="inline-flex min-h-11 min-w-11 items-center rounded-md outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              href={marketHref}
            >
              {subjectLabel} 문제마켓
            </Link>
            <Link
              className="inline-flex min-h-11 min-w-11 items-center rounded-md outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              href={`${marketHref}?sort=latest`}
            >
              최근 등록 자료
            </Link>
            <Link
              className="inline-flex min-h-11 min-w-11 items-center rounded-md outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              href={`/?subject=${subject}#source-explorer`}
            >
              교재와 출처
            </Link>
          </nav>
        </div>
      </StudioContainer>

      <div className="border-t border-[var(--studio-border)]">
        <StudioContainer className="flex flex-col gap-2 py-5 text-xs text-[var(--studio-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 써머썬 스튜디오.</p>
        </StudioContainer>
      </div>
    </footer>
  )
}
