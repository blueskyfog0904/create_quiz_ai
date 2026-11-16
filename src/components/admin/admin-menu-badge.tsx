'use client'

import { cn } from '@/lib/utils'
import { menuBadgeCount } from '@/lib/admin-alerts'
import { useAdminAlerts } from './admin-alert-context'

// 사이드바 메뉴 옆 처리 대기 건수. 메뉴 id가 아니라 메뉴 주소(href)로 맞춘다.
export function AdminMenuBadge({ href, className }: { href: string; className?: string }) {
  const alerts = useAdminAlerts()
  // 조회에 실패했으면 옛 숫자 대신 "확인 불가", 아직 첫 조회 전이면 아무것도 그리지 않는다.
  const work = alerts?.loadFailed ? null : alerts?.summary?.work
  const count = work === undefined ? undefined : menuBadgeCount(href, work)
  if (count === undefined || count === 0) return null

  return (
    <span
      title={count === null ? '처리 대기 건수 확인 불가' : undefined}
      className={cn(
        'flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
        count === null ? 'bg-amber-400 text-slate-900' : 'bg-red-600 text-white',
        className
      )}
    >
      {count === null ? (
        <>
          <span aria-hidden="true">!</span>
          <span className="sr-only">처리 대기 건수 확인 불가</span>
        </>
      ) : (
        <>
          {count > 99 ? '99+' : count}
          <span className="sr-only">건 처리 대기</span>
        </>
      )}
    </span>
  )
}
