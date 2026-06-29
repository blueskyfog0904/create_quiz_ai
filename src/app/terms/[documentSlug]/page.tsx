import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PolicyDocumentContent } from '@/components/legal/policy-document-content'
import { getFooterPolicyDocumentBySlug } from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'

interface TermsDocumentPageProps {
  params: Promise<{ documentSlug: string }>
}

export async function generateMetadata({ params }: TermsDocumentPageProps): Promise<Metadata> {
  const { documentSlug } = await params
  const footerContent = await getSiteFooterContent()
  const document = getFooterPolicyDocumentBySlug(footerContent, documentSlug)

  if (!document) {
    return {
      title: '약관 및 정책 | AI영어문제팩토리',
    }
  }

  return {
    title: `${document.title} | AI영어문제팩토리`,
    description: document.label,
  }
}

export default async function TermsDocumentPage({ params }: TermsDocumentPageProps) {
  const { documentSlug } = await params
  const footerContent = await getSiteFooterContent()
  const document = getFooterPolicyDocumentBySlug(footerContent, documentSlug)

  if (!document) {
    notFound()
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <article className="flex flex-col gap-8">
        <div>
          <Link href="/terms" className="text-sm font-medium text-gray-500 hover:text-gray-900">
            약관 및 정책 목록
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-gray-900">{document.title}</h1>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <PolicyDocumentContent content={document.content} title={document.title} />
        </div>
      </article>
    </main>
  )
}
