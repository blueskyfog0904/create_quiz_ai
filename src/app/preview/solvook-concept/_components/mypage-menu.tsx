'use client'

import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
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

// 헤더 '마이페이지' 링크가 곧 메뉴 trigger다(plan 8절, 링크 + 메뉴 trigger는 사용자 결정에 따른 변형).
// - 마우스: 링크·메뉴에 올리면 열리고, 벗어나면 CLOSE_DELAY_MS 뒤 닫힌다. hover로 연 동안에는 검색창 등의 포커스를 빼앗지 않는다.
// - 클릭·탭(모든 포인터): 메뉴를 토글하지 않고 /mypage로 이동한다. 터치에는 메뉴를 여는 수단이 없다(사용자 승인).
// - 키보드: Enter는 /mypage 이동(수정키면 새 탭), ArrowDown·Space는 메뉴 열기·진입, Esc는 Radix 기본.
export function MypageMenu({ libraryHref }: MypageMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // 마우스 hover로 연 상태. 이때만 포커스 이동·자동 포커스를 막는다.
  const [isHoverMode, setIsHoverMode] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [lastPathname, setLastPathname] = useState(pathname)
  const hintId = useId()
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

  // Radix가 여닫는 경로(키보드·Esc·바깥 클릭·항목 선택)
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
        <DropdownMenuTrigger asChild>
          <Link
            href="/mypage"
            onClick={closeMenu}
            aria-describedby={hintId}
            className="flex min-h-11 shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            onPointerDown={(event) => {
              // Radix 토글을 건너뛴다(포인터 종류 판정 없음: Safari는 click·탭의 종류 보고를 믿을 수 없다). click은 그대로 이동한다.
              event.preventDefault()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // Radix가 Enter를 토글로 쓰며 막으므로 링크 이동을 직접 실행한다.
                // 누르고 있을 때의 repeat keydown도 항상 막아 Radix 토글·네이티브 활성화가 다시 일어나지 않게 한다.
                event.preventDefault()
                if (!event.repeat) {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) {
                    window.open('/mypage', '_blank', 'noopener')
                  } else {
                    event.currentTarget.click()
                  }
                }
                return
              }
              // 닫혀 있으면 Radix 기본(열고 첫 항목 포커스). 이미 열려 있으면(hover 포함) 첫 항목으로 들어간다.
              if (open && (event.key === 'ArrowDown' || event.key === ' ')) {
                event.preventDefault()
                clearCloseTimer()
                setIsHoverMode(false)
                focusFirstItem()
              }
            }}
          >
            <UserRound aria-hidden="true" className="h-5 w-5" />
            <span className="whitespace-nowrap text-[11px] font-bold leading-none">마이페이지</span>
          </Link>
        </DropdownMenuTrigger>
        <span id={hintId} className="sr-only">아래 화살표 키로 마이페이지 메뉴를 열 수 있습니다.</span>
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
