'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// 마이페이지 메뉴: PC는 왼쪽 세로 목록, 모바일은 위쪽 가로 스크롤 목록.
const MENU = [
  { href: '/mypage', label: '마이페이지 홈' },
  { href: '/library', label: '자료 보관함' },
  { href: '/mypage/credits', label: '크레딧 관리' },
  { href: '/mypage/payments', label: '결제 내역' },
  { href: '/mypage/support', label: '고객지원' },
  { href: '/mypage/notifications', label: '알림' },
  { href: '/mypage/profile', label: '내정보 관리' },
  { href: '/mypage/consents', label: '선택 동의 관리' },
  { href: '/mypage/withdraw', label: '회원 탈퇴' },
] as const

function isActive(pathname: string, href: string) {
  return href === '/mypage' ? pathname === '/mypage' : pathname === href || pathname.startsWith(`${href}/`)
}

export function MypageSideNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="마이페이지 메뉴" className="mb-6 lg:mb-0">
      <p className="hidden pb-3 text-lg font-bold text-[var(--studio-ink)] lg:block">마이페이지</p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-[var(--studio-border)] px-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-b-0 lg:border-t lg:px-0 lg:pt-3">
        {MENU.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] max-lg:border-b-2 lg:rounded-[var(--studio-radius-control)] ${active
                  ? 'font-bold text-[var(--studio-ink)] max-lg:border-[var(--studio-ink)] lg:bg-[var(--studio-surface)]'
                  : 'font-medium text-[var(--studio-muted)] hover:text-[var(--studio-ink)] max-lg:border-transparent'
                  }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
