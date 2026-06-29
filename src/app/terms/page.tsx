import type { Metadata } from 'next'
import Link from 'next/link'
import { getVisibleFooterPolicyLinks } from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'

export const metadata: Metadata = {
  title: '약관 및 정책 | AI영어문제팩토리',
  description: '서비스 이용약관, 개인정보처리방침, 취소/환불정책',
}

export default async function TermsPage() {
  const footerContent = await getSiteFooterContent()
  const policyLinks = getVisibleFooterPolicyLinks(footerContent)

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">AI영어문제팩토리</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">약관 및 정책</h1>
          <p className="mt-3 text-gray-600">서비스 이용에 필요한 약관과 정책을 확인할 수 있습니다.</p>
        </div>

        <section className="grid gap-3">
          {policyLinks.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className="rounded-lg border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
            >
              <h2 className="text-lg font-semibold text-gray-900">{link.label}</h2>
              <p className="mt-2 text-sm text-gray-500">{link.title} 전문 보기</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  )
}
