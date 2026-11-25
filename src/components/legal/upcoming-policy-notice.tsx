import Link from 'next/link'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { policyUpcomingHref } from '@/lib/site-notice-popup'
import { getUpcomingPolicySummary } from '@/lib/site-notice-popup-server'

interface UpcomingPolicyNoticeProps {
  // 지금 약관 화면(/terms/[slug]): 그 문서가 바뀔 때만 보이고 앵커도 그 문서로.
  documentSlug?: string
  // 약관 화면·목록에서만: 시행 뒤(applied)에 '이전 판과 바뀐 부분 보기' 링크를 남긴다(6-2).
  showAppliedHistory?: boolean
  // 약관 목록(/terms) 맨 위 카드 모양
  variant?: 'line' | 'card'
  className?: string
}

const linkClass =
  'font-semibold text-[var(--studio-primary)] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

// 15번 계획 6-2: '바뀝니다 · 바뀌는 부분 보기' 한 줄 안내. 글은 모두 변경 예정 글(DB) 값이다.
// 변경 예정 글 읽기가 실패하거나 행이 없으면 아무것도 그리지 않는다.
export async function UpcomingPolicyNotice({ documentSlug, showAppliedHistory = false, variant = 'line', className }: UpcomingPolicyNoticeProps) {
  const summary = await getUpcomingPolicySummary()
  if (!summary) return null
  if (documentSlug && !summary.documents.some((document) => document.slug === documentSlug)) return null
  const href = policyUpcomingHref(documentSlug)

  let text: string | null = null
  let linkLabel: string
  if (summary.status === 'upcoming') {
    if (!summary.bannerText || !summary.bannerLinkLabel) return null
    text = summary.bannerText
    linkLabel = summary.bannerLinkLabel
  } else if (summary.status === 'applied' && showAppliedHistory && summary.historyLinkLabel) {
    linkLabel = summary.historyLinkLabel
  } else {
    return null
  }

  if (variant === 'card') {
    return (
      <Link
        href={href}
        className={cn(
          'block rounded-lg border border-[var(--studio-primary)] bg-white p-5 transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]',
          className
        )}
      >
        {summary.status === 'upcoming' && summary.footerLinkLabel ? (
          <h2 className="text-lg font-semibold text-gray-900">{summary.footerLinkLabel}</h2>
        ) : null}
        {text ? <p className="mt-2 break-keep text-sm text-gray-700">{text}</p> : null}
        <p className="mt-2 text-sm font-semibold text-[var(--studio-primary)] underline underline-offset-4">{linkLabel}</p>
      </Link>
    )
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-primary-soft)] px-4 py-3 text-sm leading-6 text-[var(--studio-ink)]',
        className
      )}
    >
      <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--studio-primary)]" />
      <p className="break-keep">
        {text ? <>{text}{' '}</> : null}
        <Link href={href} className={linkClass}>
          {linkLabel}
        </Link>
      </p>
    </div>
  )
}
