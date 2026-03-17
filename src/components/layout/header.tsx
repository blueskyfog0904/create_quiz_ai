import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HeaderClient } from './header-client'
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

export async function Header() {
  const supabase = await createClient()
  const navigationConfig = await getHeaderNavigationConfig()
  const activeNavigationItems = reorderGenerateChildren(getActiveHeaderNavigationItems(navigationConfig.items))
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
        <Link
          href="/"
          className="max-w-[220px] truncate font-bold text-xl text-primary"
        >
          {navigationConfig.logoText}
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex gap-1 items-center">
          {user ? (
            <>
              {activeNavigationItems.map((item) => (
                item.children.length > 0 ? (
                  <DropdownMenu key={item.id}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="gap-1">
                        {item.title}
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      {item.children.map((child) => (
                        <DropdownMenuItem key={child.id} asChild>
                          <Link href={child.href} className="cursor-pointer">
                            {child.title}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button key={item.id} asChild variant="ghost">
                    <Link href={item.href || '/'}>{item.title}</Link>
                  </Button>
                )
              ))}

              <HeaderClient
                key={`header-client-${user?.id || 'guest'}`}
                isLoggedIn={true}
                userName={profile?.name || profile?.email || user.email || ''}
                isAdmin={isAdmin}
                creditBalance={creditBalance}
                mainMenuItems={activeNavigationItems}
              />
            </>
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
            isMobile={true}
          />
        </div>
      </div>
    </header>
  )
}
