import { getFooterBrandName, getVisibleFooterRows } from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'

export async function Footer() {
  const footerContent = await getSiteFooterContent()
  const visibleRows = getVisibleFooterRows(footerContent)
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
        <p className="pt-2 text-center md:text-left">
          © {currentYear} {brandName}. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
