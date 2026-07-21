import Image from 'next/image'
import Link from 'next/link'
import { BookOpenText, LibraryBig, Search, Sparkles, Store } from 'lucide-react'

const previewRoot = '/preview/solvook-concept'
const boardHref = `${previewRoot}/boards/ebs-literature`
const detailHref = `${boardHref}/posts/jingsori-2027`

const primaryNavigation = [
  {
    label: 'AI 문제생성',
    href: detailHref,
    icon: Sparkles,
  },
  {
    label: '문제마켓',
    href: boardHref,
    icon: Store,
  },
  {
    label: '문제은행',
    href: `${boardHref}?view=question-bank`,
    icon: BookOpenText,
  },
  {
    label: '라이브러리',
    href: `${boardHref}?view=library`,
    icon: LibraryBig,
  },
] as const

export function PreviewHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--preview-border)] bg-white/95 backdrop-blur">
      <div className="md:hidden">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4">
          <Link
            href={previewRoot}
            aria-label="써머썬 스튜디오 프리뷰 홈"
            className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-2"
          >
            <Image
              src="/preview/solvook-concept/brand-mark.svg"
              alt=""
              aria-hidden="true"
              width={36}
              height={36}
              priority
              className="shrink-0"
            />
            <span className="truncate text-base font-extrabold tracking-[-0.02em] text-[var(--preview-ink)]">
              써머썬 스튜디오
            </span>
          </Link>
          <Link
            href={boardHref}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md bg-[var(--preview-primary)] px-3.5 text-sm font-bold text-white outline-none transition-colors hover:bg-[#5940D8] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-2"
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            자료 찾기
          </Link>
        </div>
      </div>

      <div className="hidden md:block">
        <div className="border-b border-[var(--preview-border)]">
          <div className="mx-auto flex h-[72px] max-w-[1200px] items-center gap-6 px-6">
            <Link
              href={previewRoot}
              aria-label="써머썬 스튜디오 프리뷰 홈"
              className="flex shrink-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-2"
            >
              <Image
                src="/preview/solvook-concept/brand-mark.svg"
                alt=""
                aria-hidden="true"
                width={40}
                height={40}
                priority
              />
              <span>
                <span className="block text-lg font-extrabold tracking-[-0.025em] text-[var(--preview-ink)]">
                  써머썬 스튜디오
                </span>
                <span className="block text-[11px] font-semibold tracking-[0.12em] text-[var(--preview-muted)]">
                  TEACHER WORKSPACE
                </span>
              </span>
            </Link>

            <form action={boardHref} method="get" className="relative min-w-0 flex-1">
              <label htmlFor="preview-global-search" className="sr-only">
                자료 통합 검색
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--preview-muted)]"
              />
              <input
                id="preview-global-search"
                name="q"
                type="search"
                placeholder="교재, 작품, 문제 유형을 검색해 보세요"
                className="h-11 w-full rounded-md border border-[var(--preview-border)] bg-[var(--preview-background)] pl-11 pr-4 text-sm text-[var(--preview-ink)] outline-none transition-colors placeholder:text-[var(--preview-muted)] focus:border-[var(--preview-primary)] focus:bg-white focus:ring-2 focus:ring-[#6950E5]/15"
              />
            </form>

            <div
              aria-label="사용자 유형 예시"
              className="flex shrink-0 items-center rounded-md bg-[var(--preview-background)] p-1 text-xs font-bold"
            >
              <span className="rounded-[4px] bg-white px-3 py-2 text-[var(--preview-primary)] shadow-sm">
                선생님
              </span>
              <span className="px-3 py-2 text-[var(--preview-muted)]">
                학생
              </span>
            </div>

            <Link
              href={`${boardHref}?view=library`}
              className="inline-flex h-11 shrink-0 items-center rounded-md border border-[var(--preview-border)] px-4 text-sm font-bold text-[var(--preview-text)] outline-none transition-colors hover:border-[var(--preview-primary)] hover:text-[var(--preview-primary)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-2"
            >
              내 자료
            </Link>
          </div>
        </div>

        <div className="mx-auto flex h-12 max-w-[1200px] items-center justify-between gap-6 px-6">
          <nav aria-label="프리뷰 주요 메뉴" className="flex min-w-0 items-center gap-1">
            {primaryNavigation.map((item) => {
              const Icon = item.icon

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-bold text-[var(--preview-text)] outline-none transition-colors hover:bg-[#6950E5]/[0.07] hover:text-[var(--preview-primary)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)]"
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <nav aria-label="프리뷰 과목" className="flex shrink-0 items-center gap-1 text-sm font-bold">
            <Link
              href={`${previewRoot}?subject=english`}
              className="rounded-md px-3 py-2 text-[var(--preview-muted)] outline-none transition-colors hover:text-[var(--preview-ink)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)]"
            >
              영어
            </Link>
            <Link
              href={boardHref}
              aria-current="page"
              className="rounded-md bg-[#6950E5]/10 px-3 py-2 text-[var(--preview-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)]"
            >
              국어
            </Link>
          </nav>
        </div>
      </div>
    </header>
  )
}
