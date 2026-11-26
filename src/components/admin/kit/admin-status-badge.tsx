import type { AdminTone } from '@/lib/admin-status-tone'
import { cn } from '@/lib/utils'

import { ADMIN_TONE_CLASSES } from './admin-tone-classes'

interface AdminStatusBadgeProps {
  // 상태 이름(지금 화면이 labelOf 로 만드는 글). 색만으로 구분하지 않도록 글자는 늘 있다.
  label: string
  tone: AdminTone
  className?: string
}

// 상태 배지(20번 5-2). tone 은 adminStatusTone(kind, value) 로 정한다.
export function AdminStatusBadge({ label, tone, className }: AdminStatusBadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        ADMIN_TONE_CLASSES[tone],
        className
      )}
    >
      {label}
    </span>
  )
}
