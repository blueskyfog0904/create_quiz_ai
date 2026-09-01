import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { FileText, Sparkles } from 'lucide-react'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { createClient } from '@/lib/supabase/server'
import { getMypageActivityStats, getMypageRecentActivity } from '@/lib/mypage-activity-server'
import { StudioContainer } from '@/components/design-system/studio-container'

export const metadata: Metadata = {
  title: '생성/구매 히스토리 | 써머썬 연구소',
  description: '문제와 문제지 생성·구매 활동 기록을 확인합니다.',
}

function formatKoreanDate(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-6'

export default async function MypageHistoryPage() {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/history')}`)
  }

  const supabase = await createClient()
  const [stats, { recentQuestions, recentExamPapers }] = await Promise.all([
    getMypageActivityStats(supabase, userId),
    getMypageRecentActivity(supabase, userId),
  ])

  const statCards = [
    { label: '총 문제 수', value: stats.totalQuestions, caption: `이번 달 +${stats.monthlyQuestions.toLocaleString()}개` },
    { label: 'AI 생성 문제', value: stats.aiGeneratedQuestions, caption: 'AI로 직접 생성한 문제' },
    { label: '구매한 문제', value: stats.purchasedQuestions, caption: '문제은행에서 가져온 문제' },
    { label: '생성한 문제지', value: stats.totalExamPapers, caption: `이번 달 +${stats.monthlyExamPapers.toLocaleString()}개` },
  ]

  return (
    <StudioContainer className="py-8 sm:py-10">
      <Link
        href="/mypage"
        className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] text-sm font-medium text-[var(--studio-muted)] outline-none transition-colors hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        ← 마이페이지
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">생성/구매 히스토리</h1>
      <p className="mt-2 text-sm text-[var(--studio-muted)]">
        문제와 문제지 생성·구매 활동 기록입니다.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className={cardClassName}>
            <p className="text-xs font-semibold text-[var(--studio-muted)]">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--studio-ink)]">{card.value.toLocaleString()}</p>
            <p className="mt-1 text-xs text-[var(--studio-muted)] break-keep">{card.caption}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className={cardClassName} aria-label="최근 생성/저장한 문제">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--studio-ink)]">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--studio-primary)]" />
            최근 생성/저장한 문제
          </h2>
          {recentQuestions.length > 0 ? (
            <ul className="mt-4 divide-y divide-[var(--studio-border)]">
              {recentQuestions.map((question) => (
                <li key={question.id} className="py-3">
                  <p className="truncate text-sm font-medium text-[var(--studio-text)]">{question.question_text}</p>
                  <p className="mt-0.5 text-xs text-[var(--studio-muted)]">
                    {question.source === 'ai_generated' ? 'AI 생성' : '문제은행'} · {formatKoreanDate(question.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-6 text-center text-sm text-[var(--studio-muted)]">
              아직 생성한 문제가 없습니다.
            </p>
          )}
        </section>

        <section className={cardClassName} aria-label="최근 생성한 문제지">
          <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--studio-ink)]">
            <FileText aria-hidden="true" className="h-4 w-4 text-[var(--studio-primary)]" />
            최근 생성한 문제지
          </h2>
          {recentExamPapers.length > 0 ? (
            <ul className="mt-4 divide-y divide-[var(--studio-border)]">
              {recentExamPapers.map((paper) => (
                <li key={paper.id} className="py-3">
                  <p className="truncate text-sm font-medium text-[var(--studio-text)]">{paper.paper_title}</p>
                  <p className="mt-0.5 text-xs text-[var(--studio-muted)]">{formatKoreanDate(paper.created_at)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-6 text-center text-sm text-[var(--studio-muted)]">
              아직 생성한 문제지가 없습니다.
            </p>
          )}
        </section>
      </div>
    </StudioContainer>
  )
}
