'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { SiteLogo } from '@/components/layout/site-logo'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, Coins, Grid2X2, Library, Search, UserRound, WalletCards } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { CategoryMegaMenu } from '@/components/layout/category-mega-menu'
import { MarketCartIndicator } from '@/components/market/market-cart-indicator'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

const englishHomeHref = '/?subject=english'
const koreanHomeHref = '/?subject=korean'

interface PreviewHeaderProps {
  isLoggedIn?: boolean
  initialSubject?: WorkspaceSubject
  userId?: string | null
  cartCount?: number | null
}

export function PreviewHeader({
  isLoggedIn = false,
  initialSubject = 'korean',
  userId = null,
  cartCount = null,
}: PreviewHeaderProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const paramSubject = searchParams.get('subject')
  const subject: WorkspaceSubject =
    paramSubject === 'korean' || paramSubject === 'english'
      ? paramSubject
      : initialSubject
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const homeHref = `/?subject=${subject}`
  const libraryHref = subject === 'korean' ? '/library?subject=korean' : '/library'
  // 로그인·회원가입 후 현재 위치로 돌아온다.
  const currentLocation = `${pathname ?? '/'}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const loginHref = buildAuthRedirectPath(currentLocation, '/login')
  const signupHref = buildAuthRedirectPath(currentLocation, '/signup')

  // 검색 대상 과목 — 기본은 현재 페이지 과목을 따르고, 드롭다운으로 직접 고르면 그 값을 유지한다.
  const [searchSubjectOverride, setSearchSubjectOverride] = useState<WorkspaceSubject | null>(null)
  const [searchSubjectMenuOpen, setSearchSubjectMenuOpen] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)

  // 보유 크레딧은 렌더를 막지 않도록 마운트 후 조회한다 (실패 시 표시 생략)
  useEffect(() => {
    if (!isLoggedIn) {
      setCreditBalance(null)
      return
    }
    let cancelled = false
    fetch('/api/credits/balance')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.balance === 'number') {
          setCreditBalance(data.balance)
        }
      })
      .catch(() => undefined)
    // 구매 후 잔액 갱신 이벤트를 반영한다.
    const handleBalanceUpdated = (event: Event) => {
      const balance = (event as CustomEvent<{ balance?: unknown }>).detail?.balance
      if (typeof balance === 'number') {
        setCreditBalance(balance)
      }
    }
    window.addEventListener('credit-balance-updated', handleBalanceUpdated)
    return () => {
      cancelled = true
      window.removeEventListener('credit-balance-updated', handleBalanceUpdated)
    }
  }, [isLoggedIn])
  const searchSubjectMenuRef = useRef<HTMLDivElement | null>(null)
  const searchSubject: WorkspaceSubject = searchSubjectOverride ?? subject

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const categoryTriggerDesktopRef = useRef<HTMLButtonElement | null>(null)
  const categoryTriggerMobileRef = useRef<HTMLButtonElement | null>(null)
  const categoryPanelRef = useRef<HTMLDivElement | null>(null)
  const categoryCloseTimerRef = useRef<number | null>(null)
  const searchSubjectLabel = searchSubject === 'korean' ? '국어' : '영어'
  const searchQuery = searchParams.get('q') ?? ''

  useEffect(() => {
    // 헤더 탭 등으로 페이지 과목이 바뀌면 검색 범위도 따라간다.
    setSearchSubjectOverride(null)
  }, [subject])

  useEffect(() => {
    if (!searchSubjectMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (searchSubjectMenuRef.current && !searchSubjectMenuRef.current.contains(event.target as Node)) {
        setSearchSubjectMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSearchSubjectMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [searchSubjectMenuOpen])

  useEffect(() => {
    if (!categoryMenuOpen) return

    // 트리거 2곳 + 패널을 하나의 영역으로 보고 외부 pointerdown·Escape로 닫는다.
    const containerRefs = [categoryTriggerDesktopRef, categoryTriggerMobileRef, categoryPanelRef]

    function handlePointerDown(event: PointerEvent) {
      const inside = containerRefs.some(
        (ref) => ref.current !== null && ref.current.contains(event.target as Node)
      )
      if (!inside) setCategoryMenuOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setCategoryMenuOpen(false)
    }
    // 데스크톱: 트리거·패널 밖으로 마우스가 나가면 150ms 지연 후 닫는다.
    function scheduleClose() {
      if (categoryCloseTimerRef.current !== null) {
        window.clearTimeout(categoryCloseTimerRef.current)
      }
      categoryCloseTimerRef.current = window.setTimeout(() => setCategoryMenuOpen(false), 150)
    }
    function cancelScheduledClose() {
      if (categoryCloseTimerRef.current !== null) {
        window.clearTimeout(categoryCloseTimerRef.current)
        categoryCloseTimerRef.current = null
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    const hoverTargets: HTMLElement[] = [
      categoryTriggerDesktopRef.current,
      categoryPanelRef.current,
    ].filter((element) => element !== null)
    for (const element of hoverTargets) {
      element.addEventListener('mouseleave', scheduleClose)
      element.addEventListener('mouseenter', cancelScheduledClose)
    }
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      for (const element of hoverTargets) {
        element.removeEventListener('mouseleave', scheduleClose)
        element.removeEventListener('mouseenter', cancelScheduledClose)
      }
      cancelScheduledClose()
    }
  }, [categoryMenuOpen])

  // 루트에서는 서버 재요청 없이 즉시 과목을 전환한다 (pushState는 useSearchParams와 동기화됨).
  function handleSubjectTabClick(
    event: MouseEvent<HTMLAnchorElement>,
    targetSubject: WorkspaceSubject,
    href: string
  ) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }

    document.cookie = `preferred_workspace=${targetSubject}; path=/; max-age=31536000`

    if (pathname === '/') {
      event.preventDefault()
      window.history.pushState(null, '', href)
      window.scrollTo({ top: 0 })
    }
  }

  return (
    <header className="studio-reference-gutter sticky top-0 z-50 border-b border-[var(--studio-border)] bg-[var(--studio-surface)]">
      <div className="lg:hidden">
        <StudioContainer className="flex h-16 items-center justify-between gap-3">
          <Link
            href={homeHref}
            aria-label="써머썬 연구소 홈"
            className="flex min-h-11 min-w-11 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
          >
            <SiteLogo size={34} />
            <span className="truncate text-base font-extrabold tracking-[-0.02em] text-[var(--studio-ink)]">
              써머썬 연구소
            </span>
          </Link>
          <div className="flex shrink-0 items-center">
            <MarketCartIndicator
              ownerId={userId}
              initialCount={cartCount}
              className="grid min-h-11 min-w-11 place-items-center rounded-md text-[var(--studio-text)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            />
            <Link
              href={`/search?subject=${subject}`}
              aria-label={`${subjectLabel} 자료 검색`}
              className="grid min-h-11 min-w-11 place-items-center rounded-md text-[var(--studio-text)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              <Search aria-hidden="true" className="h-5 w-5" />
            </Link>
          </div>
        </StudioContainer>

        <StudioContainer className="scrollbar-hide flex h-12 items-center gap-1 overflow-x-auto text-sm font-bold">
          <button
            ref={categoryTriggerMobileRef}
            type="button"
            aria-haspopup="true"
            aria-expanded={categoryMenuOpen}
            onClick={() => setCategoryMenuOpen((open) => !open)}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2 text-[var(--studio-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <Grid2X2 aria-hidden="true" className="h-4 w-4" />
            <span>카테고리</span>
          </button>
          <Link
            href={koreanHomeHref}
            onClick={(event) => handleSubjectTabClick(event, 'korean', koreanHomeHref)}
            aria-current={subject === 'korean' ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'korean' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
          >
            <span>국어</span>
          </Link>
          <Link
            href={englishHomeHref}
            onClick={(event) => handleSubjectTabClick(event, 'english', englishHomeHref)}
            aria-current={subject === 'english' ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'english' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
          >
            <span>영어</span>
          </Link>
          {isLoggedIn && (
            <Link
              href={libraryHref}
              className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-xs font-bold text-[var(--studio-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              <Library aria-hidden="true" className="h-4 w-4" />
              <span>보관함</span>
            </Link>
          )}
          <Link
            href="/pricing"
            className={`${isLoggedIn ? '' : 'ml-auto '}inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-xs font-bold text-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]`}
          >
            <WalletCards aria-hidden="true" className="h-4 w-4" />
            <span>캐시 충전</span>
          </Link>
        </StudioContainer>
      </div>

      <div className="hidden lg:block">
        <nav aria-label="상단 메뉴">
          <StudioContainer className="flex h-[72px] items-center gap-5">
            <Link
              href={homeHref}
              aria-label="써머썬 연구소 홈"
              className="flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2"
            >
              <SiteLogo size={38} />
              <span className="whitespace-nowrap text-lg font-black tracking-[-0.035em] text-[var(--studio-ink)]">
                써머썬 연구소
              </span>
            </Link>

            <form
              action="/search"
              method="get"
              className="relative ml-auto w-[320px]"
            >
              <label htmlFor="preview-global-search" className="sr-only">
                {searchSubjectLabel} 문제마켓 검색
              </label>
              <input type="hidden" name="subject" value={searchSubject} />
              <div ref={searchSubjectMenuRef} className="absolute left-1.5 top-1/2 -translate-y-1/2">
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={searchSubjectMenuOpen}
                  aria-label={`검색 과목 선택 (현재 ${searchSubjectLabel})`}
                  onClick={() => setSearchSubjectMenuOpen((open) => !open)}
                  className="inline-flex min-h-9 items-center gap-0.5 rounded-full px-2.5 text-xs font-bold text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-surface)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  {searchSubjectLabel}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 transition-transform ${searchSubjectMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {searchSubjectMenuOpen && (
                  <div
                    role="listbox"
                    aria-label="검색 과목"
                    className="absolute left-0 top-full z-30 mt-2 w-24 rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] py-1 shadow-[var(--studio-shadow-card)]"
                  >
                    {(['english', 'korean'] as const).map((option) => {
                      const selected = option === searchSubject
                      return (
                        <button
                          key={option}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setSearchSubjectOverride(option)
                            setSearchSubjectMenuOpen(false)
                          }}
                          className={`flex min-h-8 w-full items-center px-3.5 text-[13px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)] ${
                            selected
                              ? 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]'
                              : 'text-[var(--studio-ink)] hover:bg-[var(--studio-background)]'
                          }`}
                        >
                          {option === 'korean' ? '국어' : '영어'}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <input
                key={searchQuery}
                id="preview-global-search"
                name="q"
                type="search"
                defaultValue={searchQuery}
                placeholder="찾고 싶은 자료를 검색해 보세요"
                className="h-11 w-full rounded-full border-0 bg-[var(--studio-background)] pl-[74px] pr-12 text-[15px] text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-muted)] focus:ring-2 focus:ring-[var(--studio-focus-ring)]"
              />
              <button
                type="submit"
                aria-label="검색"
                className="absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-full text-[var(--studio-text)] outline-none hover:bg-[var(--studio-surface)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <Search aria-hidden="true" className="h-[18px] w-[18px]" />
              </button>
            </form>

            {isLoggedIn ? (
              <>
                {creditBalance !== null && (
                  <Link
                    href="/mypage/credits"
                    aria-label={`보유 크레딧 ${creditBalance.toLocaleString()}`}
                    className="flex min-h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-[var(--studio-primary)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                  >
                    <Coins aria-hidden="true" className="h-5 w-5" />
                    <span className="whitespace-nowrap text-[11px] font-bold leading-none">
                      {creditBalance.toLocaleString()} 크레딧
                    </span>
                  </Link>
                )}
                <MarketCartIndicator
                  ownerId={userId}
                  initialCount={cartCount}
                  label="장바구니"
                  className="flex min-h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                />
                <Link
                  href={libraryHref}
                  className="flex min-h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  <Library aria-hidden="true" className="h-5 w-5" />
                  <span className="whitespace-nowrap text-[11px] font-bold leading-none">자료 보관함</span>
                </Link>
                <Link
                  href="/mypage"
                  className="flex min-h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  <UserRound aria-hidden="true" className="h-5 w-5" />
                  <span className="whitespace-nowrap text-[11px] font-bold leading-none">마이페이지</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={loginHref}
                  className="inline-flex min-h-11 min-w-16 shrink-0 items-center justify-center rounded-md border border-[var(--studio-border)] px-4 text-sm font-bold text-[var(--studio-text)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  로그인
                </Link>
                <Link
                  href={signupHref}
                  className="inline-flex min-h-11 min-w-20 shrink-0 items-center justify-center rounded-md bg-[var(--studio-primary-soft)] px-4 text-sm font-bold text-[var(--studio-primary)] outline-none hover:bg-[var(--studio-primary-border)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  회원가입
                </Link>
              </>
            )}
          </StudioContainer>
        </nav>

        <StudioContainer className="flex h-12 items-center justify-between gap-6">
          <nav
            aria-label="문제마켓 과목"
            className="flex min-w-0 items-center gap-1 text-base font-extrabold"
          >
            <button
              ref={categoryTriggerDesktopRef}
              type="button"
              aria-haspopup="true"
              aria-expanded={categoryMenuOpen}
              onMouseEnter={() => setCategoryMenuOpen(true)}
              onClick={() => setCategoryMenuOpen((open) => !open)}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-1.5 text-[var(--studio-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              <Grid2X2 aria-hidden="true" className="h-[18px] w-[18px]" />
              <span>카테고리</span>
            </button>
            <Link
              href={koreanHomeHref}
              onClick={(event) => handleSubjectTabClick(event, 'korean', koreanHomeHref)}
              aria-current={subject === 'korean' ? 'page' : undefined}
              className={`inline-flex min-h-11 min-w-11 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'korean' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
            >
              <span>국어</span>
            </Link>
            <Link
              href={englishHomeHref}
              onClick={(event) => handleSubjectTabClick(event, 'english', englishHomeHref)}
              aria-current={subject === 'english' ? 'page' : undefined}
              className={`inline-flex min-h-11 min-w-11 items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${subject === 'english' ? 'border-b-2 border-[var(--studio-ink)] text-[var(--studio-ink)]' : 'text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'}`}
            >
              <span>영어</span>
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

      <CategoryMegaMenu
        open={categoryMenuOpen}
        currentSubject={subject}
        onClose={() => setCategoryMenuOpen(false)}
        panelRef={categoryPanelRef}
      />
    </header>
  )
}
