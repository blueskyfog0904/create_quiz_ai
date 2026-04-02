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
import { isWorkspaceSubject, parseWorkspaceSubjectFromPath, stripWorkspacePrefix, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { HeaderMenuItem } from '@/lib/header-navigation'

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
  const isSubjectLandingHome = shouldShowWorkspaceNav && stripWorkspacePrefix(pathname).scopedPath === '/'
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
                        variant={isSubjectLandingHome ? 'secondary' : 'ghost'}
                        className={isSubjectLandingHome ? 'shrink-0 gap-1 font-semibold text-primary' : 'shrink-0 gap-1'}
                      >
                        {item.title}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      {item.children.map((child) => (
                        <Fragment key={child.id}>
                          {isGeneratePersonalChild(item.href, child.href) ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuItem asChild>
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
                    variant={isSubjectLandingHome ? 'secondary' : 'ghost'}
                    className={isSubjectLandingHome ? 'shrink-0 font-semibold text-primary' : 'shrink-0'}
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
