import { SiteLogo } from '@/components/layout/site-logo'
import Link from 'next/link'
import { StudioContainer } from '@/components/design-system'

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
  cs?: { phone: string; hours: string; email: string }
  rows?: FooterInfoField[][]
  policyLinks?: FooterPolicyLink[]
  brandName?: string
  notices?: string[]
}

const footerLinkClassName =
  'inline-flex min-h-10 items-center rounded-md text-sm text-[var(--studio-text)] outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

export function SolvookFooter({
  cs,
  rows = [],
  policyLinks = [],
  brandName = '써머썬 연구소',
  notices = [],
}: SolvookFooterProps) {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="studio-reference-gutter mt-auto border-t border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <StudioContainer className="py-10">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <SiteLogo size={22} />
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
          </div>

          <div className="shrink-0">
            {policyLinks.length > 0 ? (
              <nav
                aria-label="약관 및 정책"
                className="flex flex-wrap items-center gap-2"
              >
                {policyLinks.map((link, index) => (
                  <span key={link.key} className="flex items-center gap-2">
                    {index > 0 ? (
                      <span aria-hidden="true" className="text-[var(--studio-border)]">
                        |
                      </span>
                    ) : null}
                    <Link className={footerLinkClassName} href={link.href}>
                      {link.label}
                    </Link>
                  </span>
                ))}
              </nav>
            ) : null}
            <div className="mt-2 space-y-1 text-xs leading-5 text-[var(--studio-muted)]">
              {cs?.phone ? <p>고객만족센터 {cs.phone}</p> : null}
              {cs?.hours ? <p>운영시간 {cs.hours}</p> : null}
              {cs?.email ? <p>이메일 {cs.email}</p> : null}
            </div>
          </div>
        </div>
      </StudioContainer>
    </footer>
  )
}
