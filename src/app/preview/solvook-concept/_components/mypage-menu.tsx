'use client'

import { useEffect, useRef, useState, type PointerEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChevronDown,
  Coins,
  CreditCard,
  HelpCircle,
  History,
  Library,
  LogOut,
  Settings,
  UserRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface MypageMenuProps {
  libraryHref: string
}

interface MypageMenuItem {
  label: string
  href: string
  icon: LucideIcon
}

// 카테고리 메뉴와 같은 지연. 트리거와 메뉴 사이 틈(sideOffset)을 지나는 동안 닫히지 않게 한다.
const CLOSE_DELAY_MS = 150

const ITEM_CLASS = 'min-h-11 cursor-pointer gap-3 [&>svg]:size-5 rounded-[var(--studio-radius-control)] px-3 text-sm font-semibold text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus:bg-[var(--studio-background)] focus:text-[var(--studio-ink)] data-[highlighted]:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

// 앱 라우트 내비게이션(코드 구조)이라 컴포넌트 상수로 둔다. 마이페이지 홈 MENU_ITEMS와 같은 방식.
function getMenuItems(libraryHref: string): MypageMenuItem[] {
  return [
    { label: '마이페이지 홈', href: '/mypage', icon: UserRound },
    { label: '자료 보관함', href: libraryHref, icon: Library },
    { label: '크레딧 관리', href: '/mypage/credits', icon: Coins },
    { label: '크레딧 충전', href: '/pricing', icon: WalletCards },
    { label: '결제 내역', href: '/mypage/payments', icon: CreditCard },
    { label: '생성/구매 히스토리', href: '/mypage/history', icon: History },
    { label: '내정보 관리', href: '/mypage/profile', icon: Settings },
    { label: '고객지원(1:1 문의)', href: '/mypage/support', icon: HelpCircle },
  ]
}

// 헤더 '마이페이지'(링크) + 메뉴 열기 chevron(split-button).
// - 마우스: 링크·chevron·메뉴에 올리면 열리고, 벗어나면 CLOSE_DELAY_MS 뒤 닫힌다. chevron 클릭은 열기만 한다
//   (닫기는 leave·바깥 클릭·Esc). hover로 연 동안에는 검색창 등의 포커스를 빼앗지 않는다.
// - 터치·펜은 Radix 기본 토글(chevron 탭으로 열고 닫기), 키보드는 Radix 기본(Enter/Space/ArrowDown으로 열기).
// - 링크 클릭·탭은 메뉴 없이 /mypage로 이동한다.
export function MypageMenu({ libraryHref }: MypageMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // 마우스(hover·chevron 클릭)로 연 상태. 이때만 포커스 이동·자동 포커스를 막는다.
  const [isHoverMode, setIsHoverMode] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [lastPathname, setLastPathname] = useState(pathname)
  const anchorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  // 헤더는 layout이라 클라이언트 이동에도 남아 있으므로 경로가 바뀌면 직접 닫는다.
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpen(false)
  }

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  useEffect(() => clearCloseTimer, [])

  const openByMouse = () => {
    clearCloseTimer()
    if (!open) {
      setIsHoverMode(true)
      setOpen(true)
    }
  }

  const handleMouseEnter = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') {
      openByMouse()
    }
  }

  const handleMouseLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || !isHoverMode) {
      return
    }
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, CLOSE_DELAY_MS)
  }

  const closeMenu = () => {
    clearCloseTimer()
    setOpen(false)
  }

  // Radix가 여닫는 경로(키보드·터치·Esc·바깥 클릭·항목 선택)
  const handleOpenChange = (nextOpen: boolean) => {
    clearCloseTimer()
    if (nextOpen) {
      setIsHoverMode(false)
    }
    setOpen(nextOpen)
  }

  const focusFirstItem = () => {
    contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus()
  }

  // Radix 항목은 마우스 pointermove에서 항목에, pointerleave(onItemLeave)에서 content에 focus()한다.
  // hover로 연 동안에는 둘 다 막아 검색창 입력 중인 포커스를 지키고, 강조는 hover: 배경으로 대신한다.
  const preventHoverFocus = (event: PointerEvent<HTMLElement>) => {
    if (isHoverMode) {
      event.preventDefault()
    }
  }
  const hoverSafeItemProps = {
    onPointerMove: preventHoverFocus,
    onPointerLeave: preventHoverFocus,
  }

  // DropdownMenuContent 타입은 onOpenAutoFocus를 노출하지 않지만, Radix Menu 2.1.16 내부(MenuContentImpl)는 이 prop을
  // FocusScope 자동 포커스에 합성한다. hover로 열 때 content가 검색창 포커스를 가져가지 않게 런타임 prop으로 넘긴다.
  const hoverOpenAutoFocusProps = {
    onOpenAutoFocus: (event: Event) => {
      if (isHoverMode) {
        event.preventDefault()
      }
    },
  } as Record<string, unknown>

  const handleLogout = async () => {
    if (isLoggingOut) {
      return
    }
    setIsLoggingOut(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error('logout failed')
      }
      window.location.href = '/login?logout=success'
    } catch {
      toast.error('로그아웃에 실패했습니다.')
      setIsLoggingOut(false)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <div
        ref={anchorRef}
        className="flex shrink-0 items-center"
        onPointerEnter={handleMouseEnter}
        onPointerLeave={handleMouseLeave}
      >
        <Link
          href="/mypage"
          onClick={closeMenu}
          className="flex min-h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
        >
          <UserRound aria-hidden="true" className="h-5 w-5" />
          <span className="whitespace-nowrap text-[11px] font-bold leading-none">마이페이지</span>
        </Link>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="마이페이지 메뉴 열기"
            className="grid min-h-11 min-w-11 place-items-center rounded-md text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] [&[data-state=open]>svg]:rotate-180"
            onPointerDown={(event) => {
              // 마우스는 Radix 토글을 막고 열기만 한다. 터치·펜은 Radix 기본 토글.
              // click의 pointerType으로 판정하지 않는다(Safari: 18.2 미만은 undefined, iOS 18.2+는 터치 탭도 'mouse').
              if (event.pointerType === 'mouse') {
                event.preventDefault()
                openByMouse()
              }
            }}
            onKeyDown={(event) => {
              // hover로 열린 상태면 Radix 기본(ArrowDown 무변화, Enter 닫힘) 대신 첫 항목으로 들어간다.
              if (open && isHoverMode && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
                event.preventDefault()
                clearCloseTimer()
                setIsHoverMode(false)
                focusFirstItem()
              }
            }}
          >
            <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform motion-reduce:transition-none" />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        ref={contentRef}
        align="end"
        sideOffset={4}
        className="w-60 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-2 text-[var(--studio-ink)] shadow-[var(--studio-shadow-card)]"
        onPointerEnter={handleMouseEnter}
        onPointerLeave={handleMouseLeave}
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault()
          }
        }}
        {...hoverOpenAutoFocusProps}
        onCloseAutoFocus={(event) => {
          if (isHoverMode) {
            event.preventDefault()
          }
        }}
      >
        {getMenuItems(libraryHref).map((item) => (
          <DropdownMenuItem key={item.label} asChild className={ITEM_CLASS} {...hoverSafeItemProps}>
            <Link href={item.href}>
              <item.icon aria-hidden="true" className="h-5 w-5 text-[var(--studio-muted)]" />
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="my-2 bg-[var(--studio-border)]" />
        <DropdownMenuItem
          disabled={isLoggingOut}
          className="min-h-11 cursor-pointer gap-3 [&>svg]:size-5 rounded-[var(--studio-radius-control)] bg-[var(--studio-highlight)] px-3 text-sm text-[var(--studio-ink)] font-extrabold outline-none hover:brightness-95 focus:bg-[var(--studio-highlight)] focus:text-[var(--studio-ink)] data-[highlighted]:brightness-95 focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          onSelect={(event) => {
            event.preventDefault()
            void handleLogout()
          }}
          {...hoverSafeItemProps}
        >
          <LogOut aria-hidden="true" className="h-5 w-5" />
          {isLoggingOut ? '로그아웃 중…' : '로그아웃'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
