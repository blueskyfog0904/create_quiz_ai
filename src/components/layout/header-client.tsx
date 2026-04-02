'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  ChevronDown,
  Menu,
  User,
  LogOut,
  CreditCard,
  Coins,
  History,
  Monitor,
  UserX,
  HelpCircle,
  Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { NotificationBell } from '@/components/ui/notification-bell'
import { WorkspaceLink } from './workspace-link'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import type { HeaderMenuItem } from '@/lib/header-navigation'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface HeaderClientProps {
  isLoggedIn: boolean
  userName: string
  isAdmin: boolean
  creditBalance?: number
  mainMenuItems?: HeaderMenuItem[]
  workspaceSubject?: WorkspaceSubject
  isMobile?: boolean
}

const accountDropdownContentClassName = 'w-52 rounded-xl border-slate-200 bg-white p-2 text-slate-900 shadow-xl shadow-slate-200/70'
const accountDropdownItemClassName = 'rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors focus:bg-slate-100 focus:text-slate-900 data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-900'
const accountDropdownSeparatorClassName = 'my-1 bg-slate-200'
const accountTriggerButtonClassName = 'gap-1 rounded-full border border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900'

export function HeaderClient({
  isLoggedIn,
  userName,
  isAdmin,
  creditBalance = 0,
  mainMenuItems = [],
  workspaceSubject = 'english',
  isMobile = false,
}: HeaderClientProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false)
  const [clientCreditBalance, setClientCreditBalance] = useState(creditBalance)
  const currentLocation = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
  const loginHref = buildAuthRedirectPath(currentLocation, '/login')
  const signupHref = buildAuthRedirectPath(currentLocation, '/signup')

  const fetchCreditBalance = useCallback(async () => {
    try {
      const res = await fetch('/api/credits/balance', {
        cache: 'no-store',
        next: { revalidate: 0 }
      })
      if (!res.ok) return
      const data = await res.json()
      if (typeof data.balance === 'number') {
        setClientCreditBalance(data.balance)
      }
    } catch {
      // Ignore header sync failures silently
    }
  }, [])

  const handleBalanceSync = useCallback((nextBalance?: number) => {
    if (typeof nextBalance === 'number') {
      setClientCreditBalance(nextBalance)
      return
    }
    void fetchCreditBalance()
  }, [fetchCreditBalance])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  useEffect(() => {
    if (!isLoggedIn) return

    const timer = window.setTimeout(() => {
      void fetchCreditBalance()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isLoggedIn, fetchCreditBalance])

  useEffect(() => {
    const handler = (event: Event) => {
      const balance = (event as CustomEvent<{ balance?: number }>).detail?.balance
      handleBalanceSync(balance)
    }

    window.addEventListener('credit-balance-updated', handler)
    return () => {
      window.removeEventListener('credit-balance-updated', handler)
    }
  }, [handleBalanceSync])

  const isGeneratePersonalChild = (parentHref?: string, childHref?: string) => (
    parentHref === '/generate' && childHref === '/generate/personal'
  )

  // Mobile Navigation
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon">
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80">
          <SheetHeader>
            <SheetTitle>메뉴</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-2 mt-6">
            {mainMenuItems.length > 0 ? (
              <>
                {mainMenuItems.map((item) => (
                  <div key={item.id} className="space-y-1">
                    {item.children.length > 0 ? (
                      <>
                        <p className="px-4 py-2 text-sm font-semibold text-gray-500">
                          {item.title}
                        </p>
                        {item.children.map((child) => (
                          <div
                            key={child.id}
                            className={isGeneratePersonalChild(item.href, child.href) ? 'mt-1 border-t border-slate-200 pt-1' : ''}
                          >
                            <WorkspaceLink href={child.href} subject={workspaceSubject} onClick={() => setIsOpen(false)}>
                              <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                                <Sparkles className="h-4 w-4" />
                                {child.title}
                              </Button>
                            </WorkspaceLink>
                          </div>
                        ))}
                      </>
                    ) : (
                      <WorkspaceLink href={item.href || '/'} subject={workspaceSubject} onClick={() => setIsOpen(false)}>
                        <Button variant="ghost" className="w-full justify-start gap-2">
                          <Sparkles className="h-4 w-4" />
                          {item.title}
                        </Button>
                      </WorkspaceLink>
                    )}
                  </div>
                ))}
                <div className="border-t my-2" />
              </>
            ) : null}

            {isLoggedIn ? (
              <>
                <p className="px-4 py-2 text-sm font-semibold text-gray-500">마이페이지</p>
                <Link href="/mypage/payments" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <CreditCard className="h-4 w-4" />
                    결제 내역
                  </Button>
                </Link>
                <Link href="/mypage/credits" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <Coins className="h-4 w-4" />
                    크레딧 관리
                  </Button>
                </Link>
                <Link href="/mypage/profile" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <User className="h-4 w-4" />
                    내정보 관리
                  </Button>
                </Link>
                <Link href="/mypage/history" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <History className="h-4 w-4" />
                    생성/구매 히스토리
                  </Button>
                </Link>
                <Link href="/mypage/devices" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <Monitor className="h-4 w-4" />
                    로그인 기기 관리
                  </Button>
                </Link>
                <Link href="/mypage/withdraw" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <UserX className="h-4 w-4" />
                    회원 탈퇴
                  </Button>
                </Link>
                <Link href="/mypage/support" onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start gap-2 pl-6">
                    <HelpCircle className="h-4 w-4" />
                    고객지원
                  </Button>
                </Link>

                {isAdmin && (
                  <>
                    <div className="border-t my-2" />
                    <Link href="/admin" onClick={() => setIsOpen(false)}>
                      <Button variant="ghost" className="w-full justify-start gap-2 text-orange-600">
                        관리자
                      </Button>
                    </Link>
                  </>
                )}

                <div className="border-t my-2" />
                <div className="px-4 py-2 text-sm text-gray-600">{userName}</div>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 text-red-600"
                  onClick={() => {
                    setIsOpen(false)
                    handleLogout()
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  로그아웃
                </Button>
              </>
            ) : (
              <>
                <Link href={loginHref} onClick={() => setIsOpen(false)}>
                  <Button variant="ghost" className="w-full justify-start">로그인</Button>
                </Link>
                <Link href={signupHref} onClick={() => setIsOpen(false)}>
                  <Button className="w-full">회원가입</Button>
                </Link>
              </>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop Navigation - Dropdown Menus
  return (
    <>
      {/* 마이페이지 드롭다운 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className={accountTriggerButtonClassName}>
            <User className="h-4 w-4" />
            <span className="hidden xl:inline">마이페이지</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={accountDropdownContentClassName}>
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/payments" className="flex items-center gap-2 cursor-pointer">
              <CreditCard className="h-4 w-4" />
              결제 내역
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/credits" className="flex items-center gap-2 cursor-pointer">
              <Coins className="h-4 w-4" />
              크레딧 관리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className={accountDropdownSeparatorClassName} />
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/profile" className="flex items-center gap-2 cursor-pointer">
              <User className="h-4 w-4" />
              내정보 관리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/history" className="flex items-center gap-2 cursor-pointer">
              <History className="h-4 w-4" />
              생성/구매 히스토리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/devices" className="flex items-center gap-2 cursor-pointer">
              <Monitor className="h-4 w-4" />
              로그인 기기 관리
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className={accountDropdownSeparatorClassName} />
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/withdraw" className="flex items-center gap-2 cursor-pointer">
              <UserX className="h-4 w-4" />
              회원 탈퇴
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={accountDropdownItemClassName}>
            <Link href="/mypage/support" className="flex items-center gap-2 cursor-pointer">
              <HelpCircle className="h-4 w-4" />
              고객지원
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 관리자 링크 */}
      {isAdmin && (
        <Link href="/admin">
          <Button variant="ghost" className="gap-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50">
            <span className="hidden xl:inline">관리자</span>
            <span className="xl:hidden">관리</span>
          </Button>
        </Link>
      )}

      {/* 사용자 정보 및 로그아웃 */}
        <div className="ml-2 flex items-center gap-1 border-l pl-3">
        <Link href="/pricing" className="mr-1 flex items-center gap-1 rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-1 hover:bg-yellow-100 transition-colors">
          <Coins className="h-4 w-4 text-yellow-600" />
          <span className="text-sm font-bold text-yellow-700">{clientCreditBalance.toLocaleString()} C</span>
        </Link>
        <div className="mr-1">
          <NotificationBell isAdmin={isAdmin} />
        </div>
        <span className="hidden 2xl:inline text-sm text-gray-600">{userName}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="text-gray-500 hover:text-red-600"
        >
          <LogOut className="mr-1 h-4 w-4" />
          <span className="hidden xl:inline">로그아웃</span>
        </Button>
      </div>
    </>
  )
}
