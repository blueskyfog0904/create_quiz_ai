'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Grid2X2, Search, WalletCards } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'

const previewRoot = '/preview/solvook-concept'
const authNext = encodeURIComponent(previewRoot)

export function PreviewHeader() {
  const searchParams = useSearchParams()
  const subject = searchParams.get('subject') === 'korean' ? 'korean' : 'english'
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const marketHref = `/${subject}/market/entexam`
  const englishPreviewHref = `${previewRoot}?subject=english`
  const koreanPreviewHref = `${previewRoot}?subject=korean`

  return (
    <header className="studio-reference-gutter sticky top-0 z-50 border-b border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <div className="lg:hidden">
        <StudioContainer className="flex h-16 items-center justify-between gap-3">
          <Link
            href={`${previewRoot}?subject=${subject}`}
            aria-label="써머썬 스튜디오 프리뷰 홈"
            className="flex min-h-11 min-w-11 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
          >
            <Image
              src="/preview/solvook-concept/brand-mark.svg"
              alt=""
              aria-hidden="true"
              width={34}
              height={34}
              priority
              className="shrink-0"
            />
            <span className="truncate text-base font-extrabold tracking-[-0.02em] text-[var(--studio-ink)]">
              써머썬 스튜디오
            </span>
          </Link>
          <Link
            href={marketHref}
            aria-label={`${subjectLabel} 문제마켓에서 검색`}
            className="grid min-h-11 min-w-11 place-items-center rounded-md text-[var(--studio-text)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <Search aria-hidden="true" className="h-5 w-5" />
          </Link>
        </StudioContainer>

        <StudioContainer className="scrollbar-hide flex h-12 items-center gap-1 overflow-x-auto text-sm font-bold">
          <span className="inline-flex min-h-11 shrink-0 items-center gap-2 px-2 text-[var(--studio-text)]">
            <Grid2X2 aria-hidden="true" className="h-4 w-4" />
            <span>카테고리</span>
          </span>
          <Link
            href={englishPreviewHref}
            aria-current={subject === 'english' ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'english' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
          >
            <span>영어</span>
          </Link>
          <Link
            href={koreanPreviewHref}
            aria-current={subject === 'korean' ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'korean' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
          >
            <span>국어</span>
          </Link>
          <Link
            href="/pricing"
            className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-xs font-bold text-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <WalletCards aria-hidden="true" className="h-4 w-4" />
            <span>캐시 충전</span>
          </Link>
        </StudioContainer>
      </div>

      <div className="hidden lg:block">
        <nav aria-label="프리뷰 상단 메뉴" className="border-b border-[var(--studio-border)]">
          <StudioContainer className="flex h-[72px] items-center gap-5">
            <Link
              href={`${previewRoot}?subject=${subject}`}
              aria-label="써머썬 스튜디오 프리뷰 홈"
              className="flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
            >
              <Image
                src="/preview/solvook-concept/brand-mark.svg"
                alt=""
                aria-hidden="true"
                width={38}
                height={38}
                priority
              />
              <span className="whitespace-nowrap text-lg font-black tracking-[-0.035em] text-[var(--studio-ink)]">
                써머썬 스튜디오
              </span>
            </Link>

            <form
              action={marketHref}
              method="get"
              className="relative ml-auto w-[320px]"
            >
              <label htmlFor="preview-global-search" className="sr-only">
                {subjectLabel} 문제마켓 검색
              </label>
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--studio-text)]">
                {subjectLabel}
              </span>
              <input
                id="preview-global-search"
                name="title"
                type="search"
                placeholder="찾고 싶은 자료를 검색해 보세요"
                className="h-11 w-full rounded-full border-0 bg-[var(--studio-background)] pl-[58px] pr-12 text-sm text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-muted)] focus:ring-2 focus:ring-[var(--studio-focus-ring)]"
              />
              <button
                type="submit"
                aria-label="검색"
                className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-full text-[var(--studio-text)] outline-none hover:bg-[var(--studio-surface)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <Search aria-hidden="true" className="h-[18px] w-[18px]" />
              </button>
            </form>

            <Link
              href={`/login?next=${authNext}`}
              className="inline-flex min-h-11 min-w-16 shrink-0 items-center justify-center rounded-md border border-[var(--studio-border)] px-4 text-sm font-bold text-[var(--studio-text)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              로그인
            </Link>
            <Link
              href={`/signup?next=${authNext}`}
              className="inline-flex min-h-11 min-w-20 shrink-0 items-center justify-center rounded-md bg-[var(--studio-primary-soft)] px-4 text-sm font-bold text-[var(--studio-primary)] outline-none hover:bg-[var(--studio-primary-border)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              회원가입
            </Link>
          </StudioContainer>
        </nav>

        <StudioContainer className="flex h-12 items-center justify-between gap-6">
          <nav
            aria-label="문제마켓 과목"
            className="flex min-w-0 items-center gap-1 text-base font-extrabold"
          >
            <span className="inline-flex min-h-11 shrink-0 items-center gap-2 px-1.5 text-[var(--studio-text)]">
              <Grid2X2 aria-hidden="true" className="h-[18px] w-[18px]" />
              <span>카테고리</span>
            </span>
            <Link
              href={englishPreviewHref}
              aria-current={subject === 'english' ? 'page' : undefined}
              className={`inline-flex min-h-11 min-w-11 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'english' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
            >
              <span>영어</span>
            </Link>
            <Link
              href={koreanPreviewHref}
              aria-current={subject === 'korean' ? 'page' : undefined}
              className={`inline-flex min-h-11 min-w-11 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'korean' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
            >
              <span>국어</span>
            </Link>
          </nav>

          <Link
            href="/pricing"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-bold text-[var(--studio-primary)] outline-none hover:bg-[var(--studio-primary-soft)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <WalletCards aria-hidden="true" className="h-4 w-4" />
            <span>캐시 충전</span>
          </Link>
        </StudioContainer>
      </div>
    </header>
  )
}
