import * as React from 'react'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ADMIN_TONE_CLASSES } from './admin-tone-classes'

type AdminNoticeKind = 'info' | 'warning' | 'error'

interface AdminNoticeProps {
  kind?: AdminNoticeKind
  title?: React.ReactNode
  children?: React.ReactNode
  // 오류 띠: 무엇을 못 읽었는지(children) + [다시 시도]
  onRetry?: () => void
  retryLabel?: string
  // 화면 읽기 역할을 덮어쓴다(기본: 오류 alert, 나머지 status). 전에 alert 로 읽히던 주의 문구를 그대로 두는 자리용.
  role?: 'alert' | 'status'
  className?: string
}

const NOTICE_TONE = { info: 'info', warning: 'warning', error: 'danger' } as const
const NOTICE_ICON = { info: Info, warning: AlertTriangle, error: AlertCircle } as const

// 정보·주의·오류 띠(20번 5-2). 브라우저 alert 를 대신할 때도 쓴다.
export function AdminNotice({ kind = 'info', title, children, onRetry, retryLabel = '다시 시도', role, className }: AdminNoticeProps) {
  const Icon = NOTICE_ICON[kind]
  return (
    <div
      role={role ?? (kind === 'error' ? 'alert' : 'status')}
      className={cn('flex items-start gap-3 rounded-[var(--studio-radius-card)] border px-4 py-3 text-sm', ADMIN_TONE_CLASSES[NOTICE_TONE[kind]], className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1 break-keep">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="adminTable" size="sm" onClick={onRetry} className="shrink-0">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
