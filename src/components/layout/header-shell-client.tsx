'use client'

import { Fragment, useMemo } from 'react'
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
import { HeaderClient } from './header-client'
import { WorkspaceLink } from './workspace-link'
import { WorkspaceSubjectToggle } from './workspace-subject-toggle'
import { cn } from '@/lib/utils'
import { isWorkspaceSubject, parseWorkspaceSubjectFromPath, stripWorkspacePrefix, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { HeaderMenuItem } from '@/lib/header-navigation'

const headerDropdownContentClassName = 'w-52 rounded-xl border-slate-200 bg-white p-2 text-slate-900 shadow-xl shadow-slate-200/70'
const headerDropdownItemClassName = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors focus:bg-slate-100 focus:text-slate-900 data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900'
const headerDropdownSeparatorClassName = 'my-1 bg-slate-200'
const subjectNavButtonClassName = 'shrink-0 rounded-full border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900'
const subjectNavButtonActiveClassName = 'border-slate-200 bg-slate-100 font-semibold text-slate-900 shadow-sm hover:bg-slate-100 hover:text-slate-900'

interface HeaderShellClientProps {
  englishMenuItems: HeaderMenuItem[]
  koreanMenuItems: HeaderMenuItem[]
  isLoggedIn: boolean
  userName: string
  isAdmin: boolean
  creditBalance: number
}

function isGeneratePersonalChild(parentHref?: string, childHref?: string) {
  return parentHref === '/generate' && childHref === '/generate/personal'
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

function isNavigationItemHighlighted(item: HeaderMenuItem, currentScopedPath: string, isSubjectLandingHome: boolean) {
  if (isSubjectLandingHome) {
    return true
  }

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
}: HeaderShellClientProps) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()

  const currentSubject = useMemo<WorkspaceSubject | null>(() => {
    const pathnameSubject = parseWorkspaceSubjectFromPath(pathname)
    if (pathnameSubject) {
      return pathnameSubject
    }

    const querySubject = searchParams.get('subject')
    return isWorkspaceSubject(querySubject) ? querySubject : null
  }, [pathname, searchParams])

  const shouldShowWorkspaceNav = currentSubject !== null
  const currentScopedPath = stripWorkspacePrefix(pathname).scopedPath
  const isSubjectLandingHome = shouldShowWorkspaceNav && currentScopedPath === '/'
  const activeNavigationItems = currentSubject === 'korean'
    ? koreanMenuItems
    : englishMenuItems

  return (
    <header className="border-b bg-white sticky top-0 z-50">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="max-w-[220px] truncate font-bold text-xl text-primary"
          >
            써머썬 연구소
          </Link>
          <WorkspaceSubjectToggle />
        </div>

        <div className="hidden md:flex flex-1 items-center justify-end gap-2 min-w-0">
          {shouldShowWorkspaceNav ? (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {activeNavigationItems.map((item) => (
                item.children.length > 0 ? (
                  <DropdownMenu key={item.id}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn(
                          subjectNavButtonClassName,
                          'gap-1',
                          isNavigationItemHighlighted(item, currentScopedPath, isSubjectLandingHome) && subjectNavButtonActiveClassName
                        )}
                      >
                        {item.title}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className={headerDropdownContentClassName}>
                      {item.children.map((child) => (
                        <Fragment key={child.id}>
                          {isGeneratePersonalChild(item.href, child.href) ? <DropdownMenuSeparator className={headerDropdownSeparatorClassName} /> : null}
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
                  <Button
                    key={item.id}
                    asChild
                    variant="ghost"
                    className={cn(
                      subjectNavButtonClassName,
                      isNavigationItemHighlighted(item, currentScopedPath, isSubjectLandingHome) && subjectNavButtonActiveClassName
                    )}
                  >
                    <WorkspaceLink href={item.href || '/'} subject={currentSubject ?? undefined}>{item.title}</WorkspaceLink>
                  </Button>
                )
              ))}
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-1">
            {isLoggedIn ? (
              <HeaderClient
                key={`header-client-${userName || 'guest'}`}
                isLoggedIn={true}
                userName={userName}
                isAdmin={isAdmin}
                creditBalance={creditBalance}
                mainMenuItems={shouldShowWorkspaceNav ? activeNavigationItems : []}
                workspaceSubject={currentSubject ?? 'english'}
              />
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link href="/login">로그인</Link>
                </Button>
                <Button asChild>
                  <Link href="/signup">회원가입</Link>
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="md:hidden">
          <HeaderClient
            key={`header-client-mobile-${userName || 'guest'}`}
            isLoggedIn={isLoggedIn}
            userName={userName}
            isAdmin={isAdmin}
            creditBalance={creditBalance}
            mainMenuItems={shouldShowWorkspaceNav ? activeNavigationItems : []}
            workspaceSubject={currentSubject ?? 'english'}
            isMobile={true}
          />
        </div>
      </div>
    </header>
  )
}
