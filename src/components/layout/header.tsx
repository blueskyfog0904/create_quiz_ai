import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HeaderClient } from './header-client'
import { WorkspaceLink } from './workspace-link'
import { WorkspaceSubjectToggle } from './workspace-subject-toggle'
import { getRequestWorkspaceContext } from '@/lib/request-workspace'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'

function reorderGenerateChildren(items: ReturnType<typeof getActiveHeaderNavigationItems>) {
  return items.map((item) => {
    if (item.href !== '/generate' || item.children.length === 0) {
      return item
    }

    const personalChild = item.children.find((child) => child.href === '/generate/personal') ?? null
    const otherChildren = item.children.filter((child) => child.href !== '/generate/personal')

    return {
      ...item,
      children: personalChild ? [...otherChildren, personalChild] : item.children,
    }
  })
}

function isGeneratePersonalChild(parentHref?: string, childHref?: string) {
  return parentHref === '/generate' && childHref === '/generate/personal'
}

export async function Header() {
  const supabase = await createClient()
  const { workspaceSubject, headerMode, scopedPath } = await getRequestWorkspaceContext()
  const shouldShowWorkspaceNav = headerMode === 'subject'
  const isSubjectLandingHome = shouldShowWorkspaceNav && scopedPath === '/'
  const activeNavigationItems = shouldShowWorkspaceNav
    ? reorderGenerateChildren(
        getActiveHeaderNavigationItems(
          (await getHeaderNavigationConfig(workspaceSubject)).items
        )
      )
    : []
  let user = null

  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
  }

  let profile = null
  let isAdmin = false
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('name, email, is_admin, credits')
      .eq('id', user.id)
      .single()
    profile = data
    isAdmin = data?.is_admin || false
  }

  // 크레딧 잔액은 profiles.credits에서 바로 읽음
  const creditBalance = profile?.credits ?? 0

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

        {/* Desktop Navigation */}
        <div className="hidden md:flex gap-1 items-center">
          {shouldShowWorkspaceNav ? activeNavigationItems.map((item) => (
            item.children.length > 0 ? (
              <DropdownMenu key={item.id}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={isSubjectLandingHome ? 'secondary' : 'ghost'}
                    className={isSubjectLandingHome ? 'gap-1 font-semibold text-primary' : 'gap-1'}
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
                        <WorkspaceLink href={child.href} subject={workspaceSubject} className="cursor-pointer">
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
                className={isSubjectLandingHome ? 'font-semibold text-primary' : undefined}
              >
                <WorkspaceLink href={item.href || '/'} subject={workspaceSubject}>{item.title}</WorkspaceLink>
              </Button>
            )
          )) : null}

          {user ? (
            <HeaderClient
              key={`header-client-${user?.id || 'guest'}`}
              isLoggedIn={true}
              userName={profile?.name || profile?.email || user.email || ''}
              isAdmin={isAdmin}
              creditBalance={creditBalance}
              mainMenuItems={activeNavigationItems}
              workspaceSubject={workspaceSubject}
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

        {/* Mobile Navigation - Client Component */}
        <div className="md:hidden">
          <HeaderClient
            key={`header-client-mobile-${user?.id || 'guest'}`}
            isLoggedIn={!!user}
            userName={profile?.name || profile?.email || user?.email || ''}
            isAdmin={isAdmin}
            creditBalance={creditBalance}
            mainMenuItems={activeNavigationItems}
            workspaceSubject={workspaceSubject}
            isMobile={true}
          />
        </div>
      </div>
    </header>
  )
}
