import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PolicyDocumentContent } from '@/components/legal/policy-document-content'
import { UpcomingPolicyNotice } from '@/components/legal/upcoming-policy-notice'
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
      title: '약관 및 정책',
    }
  }

  return {
    title: document.title,
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
          <Link
            href="/terms"
            className="inline-flex min-h-11 items-center text-sm font-medium text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            약관 및 정책 목록
          </Link>
          {/* 이 문서가 바뀔 예정이면 제목 위에 한 줄 안내, 시행 뒤에는 '이전 판과 바뀐 부분 보기'(15번 6-2) */}
          <UpcomingPolicyNotice documentSlug={document.slug} showAppliedHistory className="mt-3" />
          <h1 className="mt-3 text-3xl font-bold text-gray-900">{document.title}</h1>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <PolicyDocumentContent content={document.content} title={document.title} />
        </div>
      </article>
    </main>
  )
}
