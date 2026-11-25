import type { Metadata } from 'next'
import { createHash } from 'node:crypto'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { notFound } from 'next/navigation'
import { ConsentTextLine } from '@/components/auth/consent-checklist'
import { PolicyDocumentContent } from '@/components/legal/policy-document-content'
import { splitConsentLines } from '@/lib/signup-consent'
import {
  POLICY_UPCOMING_CONSENT_ANCHOR,
  fillPolicyTitle,
  type PolicyUpcomingDocument,
  type PolicyUpcomingDocuments,
} from '@/lib/site-notice-popup'
import { getUpcomingPolicyDocuments } from '@/lib/site-notice-popup-server'

// 15번 계획 6-1: 변경 예정 약관(바뀌는 부분 변경 전 → 변경 후, 바뀐 뒤 전문, 다시 동의를 받을 항목).
// 글은 모두 게시 행(policy_upcoming_documents) 값이다. 시행일 스크립트가 넣을 글과 글자까지 같다.

export async function generateMetadata(): Promise<Metadata> {
  const upcoming = await getUpcomingPolicyDocuments().catch(() => null)
  return { title: upcoming?.heading || '약관 및 정책' }
}

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

const KST_DATE_TIME = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatKst(iso: string) {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? KST_DATE_TIME.format(new Date(ms)) : ''
}

const linkClass =
  'inline-flex min-h-11 items-center text-sm font-semibold text-[var(--studio-primary)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

function CurrentDocumentLinks({ upcoming }: { upcoming: PolicyUpcomingDocuments }) {
  return (
    <ul className="flex flex-col gap-1">
      {upcoming.documents.map((document) => (
        <li key={document.key}>
          <Link href={`/terms/${document.slug}`} className={linkClass}>
            {fillPolicyTitle(upcoming.labels.currentLinkApplied, document.title)}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function DocumentSection({ upcoming, document }: { upcoming: PolicyUpcomingDocuments; document: PolicyUpcomingDocument }) {
  const { labels } = upcoming
  const applied = upcoming.status === 'applied'
  // 저장된 지문과 본문을 다시 대조한다. 다르면 이 문서 대신 '확인 중' 안내를 보인다.
  const intact = sha256Hex(document.content) === document.sha256
    && (!applied || sha256Hex(document.beforeContent) === document.beforeSha256)
  if (!intact) {
    console.error('[policy-upcoming] 문서 지문 불일치', document.key)
  }

  return (
    <section id={document.slug} aria-labelledby={`${document.slug}-title`} className="scroll-mt-36 rounded-lg border border-gray-200 bg-white p-6">
      <h2 id={`${document.slug}-title`} className="text-xl font-bold text-gray-900">{document.title}</h2>
      {!intact ? (
        <p className="mt-4 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">{labels.checking}</p>
      ) : (
        <>
          <ol className="mt-4 flex flex-col gap-4">
            {document.changes.map((change, index) => (
              <li key={`${document.key}-${index}`} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-gray-900">{change.label}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-gray-100 p-4">
                    <p className="text-xs font-bold text-gray-600">{labels.before}</p>
                    <div className="mt-2 break-keep text-sm leading-6 text-gray-700">
                      <PolicyDocumentContent content={change.before} />
                    </div>
                  </div>
                  <div className="rounded-md border-2 border-[var(--studio-primary)] bg-white p-4">
                    <p className="text-xs font-bold text-[var(--studio-primary)]">{labels.after}</p>
                    <div className="mt-2 break-keep text-sm leading-6 text-gray-900">
                      <PolicyDocumentContent content={change.after} />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4">
            <Link href={`/terms/${document.slug}`} className={linkClass}>
              {fillPolicyTitle(applied ? labels.currentLinkApplied : labels.currentLinkUpcoming, document.title)}
            </Link>
          </p>
          <details className="group mt-2 rounded-md border border-gray-200">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
              {labels.afterFull}
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="border-t border-gray-200 p-4">
              <PolicyDocumentContent content={document.content} title={document.title} />
            </div>
          </details>
          {applied ? (
            <details className="group mt-2 rounded-md border border-gray-200">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold text-gray-900 [&::-webkit-details-marker]:hidden">
                {labels.beforeFull}
                <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="border-t border-gray-200 p-4">
                <PolicyDocumentContent content={document.beforeContent} title={document.title} />
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  )
}

export default async function TermsUpcomingPage() {
  const upcoming = await getUpcomingPolicyDocuments()
  if (!upcoming) {
    notFound()
  }

  // 시행 전에 고지를 그만뒀거나(appliedAt 없음) 시행 뒤 되돌린 경우: 상태 줄과 지금 약관 링크만.
  if (upcoming.status === 'reverted') {
    return (
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold text-gray-900">{upcoming.heading}</h1>
        <p className="mt-4 break-keep text-gray-700">
          {upcoming.appliedAt ? upcoming.statusTexts.revertedAfterApply : upcoming.statusTexts.withdrawn}
        </p>
        <div className="mt-4">
          <CurrentDocumentLinks upcoming={upcoming} />
        </div>
      </main>
    )
  }

  const consentAnchor = POLICY_UPCOMING_CONSENT_ANCHOR

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <article className="flex flex-col gap-8">
        <header>
          <Link
            href="/terms"
            className="inline-flex min-h-11 items-center text-sm font-medium text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {upcoming.labels.backToList}
          </Link>
          <h1 className="mt-3 text-3xl font-bold text-gray-900">{upcoming.heading}</h1>
          {upcoming.status === 'applied' ? (
            <div className="mt-4 rounded-lg border border-[var(--studio-primary)] bg-white p-4">
              <p className="break-keep font-semibold text-gray-900">{upcoming.statusTexts.applied}</p>
              <div className="mt-2">
                <CurrentDocumentLinks upcoming={upcoming} />
              </div>
            </div>
          ) : null}
          <p className="mt-4 whitespace-pre-line break-keep leading-7 text-gray-700">{upcoming.intro}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-gray-600">
            <dt className="font-semibold">{upcoming.labels.effectiveDate}</dt>
            <dd>{upcoming.effectiveDateLabel}</dd>
            <dt className="font-semibold">{upcoming.labels.publishedAt}</dt>
            <dd>{formatKst(upcoming.publishedAt)}</dd>
          </dl>
        </header>

        <nav aria-label={upcoming.labels.toc} className="rounded-lg border border-gray-200 bg-white p-4">
          <ul className="flex flex-col gap-1">
            {upcoming.documents.map((document) => (
              <li key={document.key}>
                <a href={`#${document.slug}`} className={linkClass}>{document.title}</a>
              </li>
            ))}
            {upcoming.consentItems.length > 0 ? (
              <li>
                <a href={`#${consentAnchor}`} className={linkClass}>{upcoming.labels.consentSection}</a>
              </li>
            ) : null}
          </ul>
        </nav>

        {upcoming.documents.map((document) => (
          <DocumentSection key={document.key} upcoming={upcoming} document={document} />
        ))}

        {upcoming.consentItems.length > 0 ? (
          <section id={consentAnchor} aria-labelledby={`${consentAnchor}-title`} className="scroll-mt-36 rounded-lg border border-gray-200 bg-white p-6">
            <h2 id={`${consentAnchor}-title`} className="text-xl font-bold text-gray-900">{upcoming.labels.consentSection}</h2>
            <ul className="mt-4 flex flex-col gap-6">
              {upcoming.consentItems.map((item) => (
                <li key={item.key} className="flex flex-col gap-2">
                  <h3 className="text-base font-semibold text-gray-900">{item.label}</h3>
                  {item.note ? <p className="break-keep rounded-md bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-700">{item.note}</p> : null}
                  {/* 재동의 화면과 같은 줄 나누기·**강조** 그리기 */}
                  <div className="space-y-1 text-sm leading-6 text-gray-700">
                    {splitConsentLines(item.content).map((line, index) => (
                      <p key={`${item.key}-${index}`} className="break-keep">
                        <ConsentTextLine line={line} />
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </main>
  )
}
