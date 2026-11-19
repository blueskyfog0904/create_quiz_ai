import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import { createClient } from '@/lib/supabase/server'
import {
  getCreditBalanceSnapshot,
  logCreditBalanceMismatch,
  selectDisplayBalance,
} from '@/lib/credit-balance'
import { countMarketLibraryItemsForUser } from '@/lib/market-items-server'
import { MypageLogoutButton } from './_components/mypage-logout-button'

export const metadata: Metadata = {
  title: '마이페이지',
  description: '내 정보와 크레딧, 결제 내역, 활동 기록을 한눈에 관리합니다.',
}

function formatKoreanDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-6'

export default async function MypageHomePage() {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage')}`)
  }

  const supabase = await createClient()

  const [{ data: profile }, { data: userResult }, snapshot, purchasedCounts] = await Promise.all([
    supabase.from('profiles').select('created_at, display_tag').eq('id', userId).single(),
    supabase.auth.getUser(),
    getCreditBalanceSnapshot(userId),
    countMarketLibraryItemsForUser(userId),
  ])

  if (snapshot.hasMismatch) {
    logCreditBalanceMismatch('mypage home', userId, snapshot)
  }

  const balance = selectDisplayBalance(userId, snapshot)
  const email = userResult.user?.email ?? ''
  // 기본 과목(영어)에 구매 자료가 없으면 자료가 있는 과목의 보관함으로 안내한다
  const libraryHref =
    purchasedCounts.english === 0 && purchasedCounts.korean > 0
      ? '/library?subject=korean'
      : '/library'

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">마이페이지</h1>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className={cardClassName} aria-label="내 정보">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--studio-ink)]">내 정보</h2>
              <p className="mt-3 text-lg font-semibold text-[var(--studio-ink)] break-keep">
                {formatMemberDisplayName(email, profile?.display_tag)}
              </p>
              <p className="mt-1 text-sm text-[var(--studio-text)]">{email}</p>
              <p className="mt-1 text-xs text-[var(--studio-muted)]">
                가입일 {formatKoreanDate(profile?.created_at)}
              </p>
            </div>
            <MypageLogoutButton />
          </div>
          <div className="mt-4">
            <Link
              href="/mypage/profile"
              className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] text-sm font-semibold text-[var(--studio-primary)] outline-none transition-colors hover:text-[var(--studio-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              내정보 관리 →
            </Link>
          </div>
        </section>

        <section className={cardClassName} aria-label="크레딧">
          <h2 className="text-sm font-bold text-[var(--studio-ink)]">크레딧</h2>
          <p className="mt-3 text-2xl font-bold text-[var(--studio-ink)]">
            {balance.toLocaleString()}
            <span className="ml-1 text-sm font-semibold text-[var(--studio-muted)]">크레딧</span>
          </p>
          <p className="mt-1 text-xs text-[var(--studio-muted)]">
            {snapshot.nextExpirationAt
              ? `다음 소멸 예정 ${formatKoreanDate(snapshot.nextExpirationAt)}`
              : '소멸 예정 크레딧 없음'}
            {snapshot.expiredBalance > 0
              ? ` · 만료 크레딧 ${snapshot.expiredBalance.toLocaleString()}`
              : ''}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/pricing"
              className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] bg-[var(--studio-primary)] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[var(--studio-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              충전하기
            </Link>
            <Link
              href="/mypage/credits"
              className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-4 text-sm font-medium text-[var(--studio-ink)] outline-none transition-colors hover:border-[var(--studio-primary-border)] hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              크레딧 관리
            </Link>
          </div>
        </section>
      </div>

      {/* 구매한 자료 수(메뉴는 왼쪽 마이페이지 메뉴로 대신한다) */}
      <Link
        href={libraryHref}
        className={`${cardClassName} mt-5 flex min-h-11 items-center justify-between gap-3 outline-none transition-colors hover:border-[var(--studio-primary-border)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]`}
      >
        <span className="text-sm font-bold text-[var(--studio-ink)]">구매한 자료</span>
        <span className="text-sm text-[var(--studio-muted)]">
          <strong className="mr-1 text-lg font-bold text-[var(--studio-ink)]">{purchasedCounts.total.toLocaleString()}</strong>
          개 · 자료 보관함 보기 →
        </span>
      </Link>
    </div>
  )
}
