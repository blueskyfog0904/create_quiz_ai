'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { StudioContainer } from '@/components/design-system'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface FooterInfoField {
  label: string
  value: string
}

interface FooterPolicyLink {
  key: string
  label: string
  href: string
}

interface SolvookFooterProps {
  initialSubject?: WorkspaceSubject
  cs?: { phone: string; hours: string; email: string }
  rows?: FooterInfoField[][]
  policyLinks?: FooterPolicyLink[]
  brandName?: string
  notices?: string[]
}

const footerLinkClassName =
  'inline-flex min-h-10 items-center rounded-md text-sm text-[var(--studio-text)] outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

export function SolvookFooter({
  initialSubject = 'english',
  cs,
  rows = [],
  policyLinks = [],
  brandName = '써머썬 스튜디오',
  notices = [],
}: SolvookFooterProps) {
  const searchParams = useSearchParams()
  const paramSubject = searchParams.get('subject')
  const subject: WorkspaceSubject =
    paramSubject === 'korean' || paramSubject === 'english'
      ? paramSubject
      : initialSubject
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const marketHref = `/${subject}/market/entexam`
  const currentYear = new Date().getFullYear()

  return (
    <footer className="studio-reference-gutter mt-auto border-t border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <StudioContainer className="grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--studio-ink)]">고객만족센터</h2>
          {cs?.phone ? (
            <p className="mt-3 text-2xl font-black tracking-[-0.02em] text-[var(--studio-ink)]">
              {cs.phone}
            </p>
          ) : null}
          <div className="mt-2 space-y-1 text-sm text-[var(--studio-muted)]">
            {cs?.hours ? <p>운영시간 {cs.hours}</p> : null}
            {cs?.email ? <p>이메일 {cs.email}</p> : null}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold text-[var(--studio-ink)]">자료 탐색</h2>
          <nav aria-label="푸터 자료 탐색" className="mt-3 flex flex-col items-start gap-1">
            <Link className={footerLinkClassName} href={marketHref}>
              {subjectLabel} 문제마켓
            </Link>
            <Link className={footerLinkClassName} href={`${marketHref}?sort=latest`}>
              최근 등록 자료
            </Link>
            <Link className={footerLinkClassName} href={`/?subject=${subject}#source-explorer`}>
              교재와 출처
            </Link>
          </nav>
        </div>

        {policyLinks.length > 0 ? (
          <div>
            <h2 className="text-sm font-bold text-[var(--studio-ink)]">약관 및 정책</h2>
            <nav aria-label="약관 및 정책" className="mt-3 flex flex-col items-start gap-1">
              {policyLinks.map((link) => (
                <Link key={link.key} className={footerLinkClassName} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        ) : null}
      </StudioContainer>

      <div className="border-t border-[var(--studio-border)]">
        <StudioContainer className="py-6">
          <div className="flex items-center gap-2">
            <Image src="/brand-mark.svg" alt="" aria-hidden="true" width={22} height={22} />
            <span className="text-sm font-extrabold tracking-[-0.02em] text-[var(--studio-ink)]">
              {brandName}
            </span>
          </div>
          <div className="mt-3 space-y-1 text-xs leading-5 text-[var(--studio-muted)]">
            {rows.map((row, index) => (
              <p key={`footer-row-${index}`}>
                {row.map((field) => `${field.label}: ${field.value}`).join(' | ')}
              </p>
            ))}
            {notices.map((notice, index) => (
              <p key={`footer-notice-${index}`}>{notice}</p>
            ))}
            <p className="pt-2">
              © {currentYear} {brandName}. All rights reserved.
            </p>
          </div>
        </StudioContainer>
      </div>
    </footer>
  )
}
