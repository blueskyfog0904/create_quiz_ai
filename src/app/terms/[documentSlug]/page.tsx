import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PolicyDocumentContent } from '@/components/legal/policy-document-content'
import { getFooterPolicyDocumentBySlug } from '@/lib/footer-content'
import { getSiteFooterContent } from '@/lib/footer-content-server'

interface TermsDocumentPageProps {
  params: Promise<{ documentSlug: string }>
}

const REQUIRED_POINT_CHARGE_POLICY_SENTENCE =
  '충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.'

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

  const needsPointChargePolicyFallback =
    (documentSlug === 'service' || documentSlug === 'refund') &&
    !document.content.includes(REQUIRED_POINT_CHARGE_POLICY_SENTENCE)

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
          <h1 className="mt-3 text-3xl font-bold text-gray-900">{document.title}</h1>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <PolicyDocumentContent content={document.content} title={document.title} />
          {needsPointChargePolicyFallback && (
            <section
              aria-labelledby="point-charge-policy-heading"
              className="mt-8 border-t border-gray-200 pt-8 text-gray-700"
            >
              <h2
                id="point-charge-policy-heading"
                className="text-xl font-bold text-gray-900"
              >
                포인트 충전 핵심 안내
              </h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 leading-7">
                <li>
                  크레딧은 월 구독이나 자동결제가 아닌 1회 충전 상품이며,
                  1회 충전금액은 100,000원 이하로 제한됩니다.
                </li>
                <li>{REQUIRED_POINT_CHARGE_POLICY_SENTENCE}</li>
                <li>
                  충전 크레딧은 결제한 회원 계정에 귀속되며 회원 간
                  양도·이전하거나 현금으로 교환할 수 없습니다.
                </li>
                <li>
                  구매 후 7일 이내이고 해당 충전 건을 전혀 사용하지 않은
                  경우에만 환불을 신청할 수 있으며, 승인된 환불은 결제
                  당시 사용한 원 결제수단으로 처리합니다.
                </li>
                <li>
                  일반결제는 신용·체크카드와 계약된 네이버페이, 페이코,
                  토스페이를 지원합니다. 카카오페이 직접결제는 별도 운영 승인 후
                  카카오페이머니만 제공하며 계좌이체, 퀵계좌이체, 가상계좌,
                  하나카드와 일부 카드사는 이용이 제한될 수 있습니다.
                </li>
              </ul>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/pricing"
                  className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  충전 상품과 사용처 보기
                </Link>
                <Link
                  href="/mypage/credits"
                  className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  충전·사용 내역 보기
                </Link>
                {documentSlug !== 'refund' && (
                  <Link
                    href="/terms/refund"
                    className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    취소/환불정책 보기
                  </Link>
                )}
              </div>
            </section>
          )}
        </div>
      </article>
    </main>
  )
}
