'use client'

import { Fragment, useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { MarketCartIndicator } from '@/components/market/market-cart-indicator'
import { HeaderClient } from './header-client'
import { SiteLogo } from './site-logo'
import { WorkspaceLink } from './workspace-link'
import { WorkspaceSubjectToggle } from './workspace-subject-toggle'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import { cn } from '@/lib/utils'
import { isWorkspaceSubject, parseWorkspaceSubjectFromPath, stripWorkspacePrefix, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { HeaderMenuItem } from '@/lib/header-navigation'

const headerDropdownContentClassName = 'w-52 rounded-xl border-slate-200 bg-white p-2 text-slate-900 shadow-md shadow-slate-900/10'
const headerDropdownItemClassName = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors focus:bg-slate-100 focus:text-slate-900 data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900'
const headerDropdownSeparatorClassName = 'my-1 bg-slate-200'
const subjectNavButtonClassName = 'shrink-0 gap-1 rounded-full border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900'
const subjectNavButtonActiveClassName = 'font-medium text-slate-900 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900'

interface HeaderShellClientProps {
  englishMenuItems: HeaderMenuItem[]
  koreanMenuItems: HeaderMenuItem[]
  isLoggedIn: boolean
  userName: string
  isAdmin: boolean
  creditBalance: number
  userId: string | null
  cartCount: number | null
}

function isGeneratePersonalChild(parentHref?: string, childHref?: string) {
  return parentHref === '/generate' && childHref === '/generate/personal'
}

function shouldRenderChildDivider(parentHref: string | undefined, child: { href: string, showDividerBefore?: boolean }) {
  return Boolean(child.showDividerBefore) || isGeneratePersonalChild(parentHref, child.href)
}

function matchesSubjectPath(currentScopedPath: string, href?: string) {
  if (!href) {
    return false
  }

  if (href === '/') {
    return currentScopedPath === '/'
  }

  return currentScopedPath === href || currentScopedPath.startsWith(`${href}/`)
}

function isNavigationItemHighlighted(item: HeaderMenuItem, currentScopedPath: string) {
  if (matchesSubjectPath(currentScopedPath, item.href)) {
    return true
  }

  return item.children.some((child) => matchesSubjectPath(currentScopedPath, child.href))
}

export function HeaderShellClient({
  englishMenuItems,
  koreanMenuItems,
  isLoggedIn,
  userName,
  isAdmin,
  creditBalance,
  userId,
  cartCount,
}: HeaderShellClientProps) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const isInteractiveReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  // 레거시 라우트(/legacy/{subject}/...)에서도 워크스페이스 내비를 유지한다
  const legacyAwarePathname = pathname.startsWith('/legacy/')
    ? pathname.slice('/legacy'.length)
    : pathname

  const currentSubject = useMemo<WorkspaceSubject | null>(() => {
    const pathnameSubject = parseWorkspaceSubjectFromPath(legacyAwarePathname)
    if (pathnameSubject) {
      return pathnameSubject
    }

    const querySubject = searchParams.get('subject')
    return isWorkspaceSubject(querySubject) ? querySubject : null
  }, [legacyAwarePathname, searchParams])

  const shouldShowWorkspaceNav = currentSubject !== null
  const currentScopedPath = stripWorkspacePrefix(legacyAwarePathname).scopedPath
  const activeNavigationItems = currentSubject === 'korean'
    ? koreanMenuItems
    : englishMenuItems
  const visibleNavigationItems = isLoggedIn
    ? activeNavigationItems
    : activeNavigationItems.filter((item) => item.href !== '/library')
  const pricingNavigationItem = visibleNavigationItems.find((item) => item.href === '/pricing')
  const desktopNavigationItems = visibleNavigationItems.filter((item) => item.href !== '/pricing')
  const currentLocation = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const loginHref = buildAuthRedirectPath(currentLocation, '/login')
  const signupHref = buildAuthRedirectPath(currentLocation, '/signup')
  const cartIndicatorClassName = 'grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full text-slate-600 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

  return (
    <header className="border-b bg-white sticky top-0 z-50">
      <div className="container mx-auto flex h-16 items-center justify-between gap-2 px-4 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
          <Link
            href="/"
            className="flex min-w-0 max-w-[220px] items-center gap-2 font-bold text-xl text-primary"
          >
            <SiteLogo size={34} />
            <span className="truncate">써머썬 연구소</span>
          </Link>
          <WorkspaceSubjectToggle />
        </div>

        <div className="hidden md:flex flex-1 items-center justify-end gap-2 min-w-0">
          {shouldShowWorkspaceNav ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {desktopNavigationItems.map((item) => (
                item.children.length > 0 && isInteractiveReady ? (
                  <DropdownMenu key={item.id}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          subjectNavButtonClassName,
                          isNavigationItemHighlighted(item, currentScopedPath) && subjectNavButtonActiveClassName
                        )}
                      >
                        {item.title}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className={headerDropdownContentClassName}>
                      {item.children.map((child) => (
                        <Fragment key={child.id}>
                          {shouldRenderChildDivider(item.href, child) ? <DropdownMenuSeparator className={headerDropdownSeparatorClassName} /> : null}
                          <DropdownMenuItem asChild className={headerDropdownItemClassName}>
                            <WorkspaceLink href={child.href} subject={currentSubject ?? undefined} className="cursor-pointer">
                              {child.title}
                            </WorkspaceLink>
                          </DropdownMenuItem>
                        </Fragment>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  item.href ? (
                    <Button
                      key={item.id}
                      asChild
                      variant="ghost"
                      className={cn(
                        subjectNavButtonClassName,
                        isNavigationItemHighlighted(item, currentScopedPath) && subjectNavButtonActiveClassName
                      )}
                    >
                      <WorkspaceLink href={item.href} subject={currentSubject ?? undefined}>{item.title}</WorkspaceLink>
                    </Button>
                  ) : (
                    <Button
                      key={item.id}
                      variant="ghost"
                      className={cn(
                        subjectNavButtonClassName,
                        isNavigationItemHighlighted(item, currentScopedPath) && subjectNavButtonActiveClassName
                      )}
                    >
                      {item.title}
                    </Button>
                  )
                )
              ))}
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-1">
            {pricingNavigationItem ? (
              <Button
                asChild
                variant="ghost"
                className={cn(
                  subjectNavButtonClassName,
                  matchesSubjectPath(currentScopedPath, pricingNavigationItem.href) && subjectNavButtonActiveClassName
                )}
              >
                <WorkspaceLink href={pricingNavigationItem.href || '/pricing'} subject={currentSubject ?? undefined}>
                  {pricingNavigationItem.title}
                </WorkspaceLink>
              </Button>
            ) : null}
            <MarketCartIndicator ownerId={userId} initialCount={cartCount} className={cartIndicatorClassName} />
            {isLoggedIn ? (
              <HeaderClient
                key={`header-client-${userName || 'guest'}`}
                isLoggedIn={true}
                userName={userName}
                isAdmin={isAdmin}
                creditBalance={creditBalance}
                mainMenuItems={shouldShowWorkspaceNav ? visibleNavigationItems : []}
                workspaceSubject={currentSubject ?? 'english'}
              />
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href={loginHref}>로그인</Link>
                </Button>
                <Button asChild>
                  <Link href={signupHref}>회원가입</Link>
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 md:hidden">
          <MarketCartIndicator ownerId={userId} initialCount={cartCount} className={cartIndicatorClassName} />
          <HeaderClient
            key={`header-client-mobile-${userName || 'guest'}`}
            isLoggedIn={isLoggedIn}
            userName={userName}
            isAdmin={isAdmin}
            creditBalance={creditBalance}
            mainMenuItems={shouldShowWorkspaceNav ? visibleNavigationItems : []}
            workspaceSubject={currentSubject ?? 'english'}
            isMobile={true}
          />
        </div>
      </div>
    </header>
  )
}
