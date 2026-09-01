import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import {
  Coins,
  CreditCard,
  FileText,
  HelpCircle,
  History,
  Sparkles,
  User,
  UserX,
} from 'lucide-react'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { createClient } from '@/lib/supabase/server'
import {
  getCreditBalanceSnapshot,
  logCreditBalanceMismatch,
  selectDisplayBalance,
} from '@/lib/credit-balance'
import { getMypageActivityStats } from '@/lib/mypage-activity-server'
import { StudioContainer } from '@/components/design-system/studio-container'
import { MypageLogoutButton } from './_components/mypage-logout-button'

export const metadata: Metadata = {
  title: '마이페이지 | 써머썬 연구소',
  description: '내 정보와 크레딧, 결제 내역, 활동 기록을 한눈에 관리합니다.',
}

const MENU_ITEMS = [
  { href: '/mypage/payments', label: '결제 내역', description: '요금제 결제·환불 기록', icon: CreditCard },
  { href: '/mypage/credits', label: '크레딧 관리', description: '잔액·구매·거래 내역', icon: Coins },
  { href: '/mypage/profile', label: '내정보 관리', description: '휴대폰 번호·비밀번호 변경', icon: User },
  { href: '/mypage/history', label: '생성/구매 히스토리', description: '문제·문제지 활동 기록', icon: History },
  { href: '/legacy/mypage/support', label: '고객지원', description: '1:1 문의 접수·확인', icon: HelpCircle },
  { href: '/legacy/mypage/withdraw', label: '회원 탈퇴', description: '계정 및 데이터 삭제', icon: UserX },
] as const

function formatKoreanDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-6'

export default async function MypageHomePage() {
  await connection()
  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage')}`)
  }

  const supabase = await createClient()

  const [{ data: profile }, { data: userResult }, snapshot, stats] = await Promise.all([
    supabase.from('profiles').select('name, created_at').eq('id', userId).single(),
    supabase.auth.getUser(),
    getCreditBalanceSnapshot(userId),
    getMypageActivityStats(supabase, userId),
  ])

  if (snapshot.hasMismatch) {
    logCreditBalanceMismatch('mypage home', userId, snapshot)
  }

  const balance = selectDisplayBalance(userId, snapshot)
  const email = userResult.user?.email ?? ''

  return (
    <StudioContainer className="py-8 sm:py-10">
      <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">마이페이지</h1>
      <p className="mt-2 text-sm text-[var(--studio-muted)]">
        내 정보와 크레딧, 활동 기록을 한눈에 확인합니다.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className={cardClassName} aria-label="내 정보">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--studio-ink)]">내 정보</h2>
              <p className="mt-3 text-lg font-semibold text-[var(--studio-ink)] break-keep">
                {profile?.name ?? '이름 미설정'}
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

      <section className={`${cardClassName} mt-5`} aria-label="활동 요약">
        <h2 className="text-sm font-bold text-[var(--studio-ink)]">활동 요약</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--studio-muted)]">
              <FileText aria-hidden="true" className="h-3.5 w-3.5" />총 문제 수
            </p>
            <p className="mt-1 text-xl font-bold text-[var(--studio-ink)]">{stats.totalQuestions.toLocaleString()}</p>
            <p className="text-xs text-[var(--studio-muted)]">이번 달 +{stats.monthlyQuestions.toLocaleString()}개</p>
          </div>
          <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--studio-muted)]">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />AI 생성 문제
            </p>
            <p className="mt-1 text-xl font-bold text-[var(--studio-ink)]">{stats.aiGeneratedQuestions.toLocaleString()}</p>
            <p className="text-xs text-[var(--studio-muted)]">AI로 직접 생성</p>
          </div>
          <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--studio-muted)]">
              <History aria-hidden="true" className="h-3.5 w-3.5" />구매한 문제
            </p>
            <p className="mt-1 text-xl font-bold text-[var(--studio-ink)]">{stats.purchasedQuestions.toLocaleString()}</p>
            <p className="text-xs text-[var(--studio-muted)]">문제은행에서 가져옴</p>
          </div>
          <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--studio-muted)]">
              <FileText aria-hidden="true" className="h-3.5 w-3.5" />생성한 문제지
            </p>
            <p className="mt-1 text-xl font-bold text-[var(--studio-ink)]">{stats.totalExamPapers.toLocaleString()}</p>
            <p className="text-xs text-[var(--studio-muted)]">이번 달 +{stats.monthlyExamPapers.toLocaleString()}개</p>
          </div>
        </div>
      </section>

      <section className="mt-5" aria-label="바로가기">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-11 items-center gap-3 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 outline-none transition-colors hover:border-[var(--studio-primary-border)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--studio-primary-soft)]">
                  <Icon aria-hidden="true" className="h-5 w-5 text-[var(--studio-primary)]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--studio-ink)] break-keep">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-[var(--studio-muted)] break-keep">{item.description}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </section>
    </StudioContainer>
  )
}
