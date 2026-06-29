import Link from 'next/link'
import { getFooterBrandName, getVisibleFooterPolicyLinks, getVisibleFooterRows } from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'

export async function Footer() {
  const footerContent = await getSiteFooterContent()
  const visibleRows = getVisibleFooterRows(footerContent)
  const policyLinks = getVisibleFooterPolicyLinks(footerContent)
  const brandName = getFooterBrandName(footerContent)
  const currentYear = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t bg-white py-8">
      <div className="container mx-auto space-y-2 px-4 text-sm text-gray-500">
        {visibleRows.map((row, index) => (
          <p key={`footer-row-${index}`} className="text-center md:text-left">
            {row.map((field) => `${field.label}: ${field.value.trim()}`).join(' | ')}
          </p>
        ))}
        {footerContent.extraNotices.map((notice, index) => (
          <p key={`footer-notice-${index}`} className="text-center md:text-left">
            {notice}
          </p>
        ))}
        {policyLinks.length > 0 ? (
          <nav aria-label="약관 및 정책" className="flex flex-wrap justify-center gap-2 pt-3 md:justify-start">
            {policyLinks.map((link, index) => (
              <span key={link.key} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true" className="text-gray-300">|</span> : null}
                <Link href={link.href} className="font-medium text-gray-600 hover:text-gray-900">
                  {link.label}
                </Link>
              </span>
            ))}
          </nav>
        ) : null}
        <p className="pt-2 text-center md:text-left">
          © {currentYear} {brandName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
